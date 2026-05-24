// sdocs-forms.js — browser renderer for fenced ```form blocks.
//
// Runs after marked + DOMPurify. Walks the rendered DOM, finds code
// blocks tagged language-form, parses the YAML body via
// SDocFormBlock.parseFormBlock, and replaces the <pre><code> with real
// <form> DOM (createElement only — never innerHTML for user-controlled
// strings).
//
// Submitting a button: gathers in-scope field values, packages a
// `submitForm` event, and dispatches it. The bridge (sdocs-bridge.js)
// listens and turns the event into a WebSocket message.
//
// Re-renders are triggered by the orchestrator (sdocs-app.js) the same
// way charts and mermaid hook in.

(function () {
'use strict';
if (typeof window === 'undefined') return;
var S = window.SDocs;
if (!S) return;

var FB = window.SDocFormBlock;
if (!FB) {
  // Module-load order safety: the shared form-block module must be in
  // place before this script. Without it we can't parse and we'd render
  // nothing useful; fall through quietly so the page still works.
  return;
}

// ─── Public render entrypoint ─────────────────────────────────

function renderForms(root) {
  var scope = root || document.getElementById('_sd_rendered');
  if (!scope) return;
  var codeBlocks = scope.querySelectorAll('pre > code.language-form');
  var mounted = 0;
  for (var i = 0; i < codeBlocks.length; i++) {
    mountForm(codeBlocks[i]);
    mounted++;
  }
  // Tests + bridge-driven UX hooks listen for this. Fired even when
  // nothing was mounted so a re-render of a doc that removed all form
  // blocks is also observable.
  try {
    var ev = new CustomEvent('sdocs-form-rerendered', {
      bubbles: true,
      detail: { count: mounted },
    });
    document.dispatchEvent(ev);
  } catch (_) {}
}

function mountForm(codeEl) {
  var pre = codeEl.parentNode;
  if (!pre || pre.tagName !== 'PRE') return;
  // attachCodeCopyButtons() in sdocs-app.js wraps every <pre> in
  // .pre-wrapper and adds a copy button next to it. Replace the wrapper,
  // not just the <pre>, so the copy button doesn't orphan beside the form.
  var target = pre.closest('.pre-wrapper') || pre;
  var src = codeEl.textContent || '';
  var parsed = FB.parseFormBlock(src);
  var host = document.createElement('div');
  host.className = 'sdoc-form-host';
  if (parsed.error) {
    renderError(host, parsed.error, src);
    target.replaceWith(host);
    return;
  }
  renderForm(host, parsed.value);
  target.replaceWith(host);
}

// ─── Error fallback ───────────────────────────────────────────

function renderError(host, message, src) {
  host.classList.add('sdoc-form-error');
  var label = document.createElement('div');
  label.className = 'sdoc-form-error-label';
  label.textContent = 'Form block error: ' + message;
  host.appendChild(label);
  var codeWrap = document.createElement('pre');
  var code = document.createElement('code');
  code.className = 'language-form';
  code.textContent = src;
  codeWrap.appendChild(code);
  host.appendChild(codeWrap);
}

// ─── Real form rendering ──────────────────────────────────────

function renderForm(host, block) {
  var token = FB.formRevisionToken(block.fields, block.buttons);
  var form = document.createElement('form');
  form.className = 'sdoc-form';
  form.setAttribute('data-form-id', block.id);
  form.setAttribute('data-form-token', token);
  form.setAttribute('novalidate', 'true');
  form.addEventListener('submit', function (e) { e.preventDefault(); });

  // Group buttons by their inline-anchor field (if any). Bottom-row
  // buttons are those without `after`.
  var inlineButtonsByField = {};
  var bottomButtons = [];
  block.buttons.forEach(function (b) {
    if (b.after && typeof b.after === 'string') {
      (inlineButtonsByField[b.after] = inlineButtonsByField[b.after] || []).push(b);
    } else {
      bottomButtons.push(b);
    }
  });

  // Render each field, slotting in any buttons anchored to it.
  block.fields.forEach(function (f) {
    var initial = (block.answers && Object.prototype.hasOwnProperty.call(block.answers, f.name))
      ? block.answers[f.name]
      : f.default;
    form.appendChild(renderField(f, initial));
    var inline = inlineButtonsByField[f.name];
    if (inline && inline.length) {
      var inlineRow = document.createElement('div');
      inlineRow.className = 'sdoc-form-buttons sdoc-form-buttons-inline';
      inline.forEach(function (b) {
        inlineRow.appendChild(renderButton(b, block, form, token));
      });
      form.appendChild(inlineRow);
    }
  });

  // Bottom-row buttons (those with no `after`).
  if (bottomButtons.length) {
    var btnRow = document.createElement('div');
    btnRow.className = 'sdoc-form-buttons';
    bottomButtons.forEach(function (b) {
      btnRow.appendChild(renderButton(b, block, form, token));
    });
    form.appendChild(btnRow);
  }

  host.appendChild(form);
}

function renderField(field, initialValue) {
  var wrap = document.createElement('div');
  wrap.className = 'sdoc-form-field sdoc-form-field-' + field.type;
  wrap.setAttribute('data-field', field.name);

  var label = document.createElement('label');
  label.className = 'sdoc-form-label';
  if (field.label) label.textContent = field.label;
  if (field.required) {
    var marker = document.createElement('span');
    marker.className = 'sdoc-form-required';
    marker.textContent = ' *';
    label.appendChild(marker);
  }
  wrap.appendChild(label);

  var control;
  if (field.type === 'text') {
    control = document.createElement('input');
    control.type = 'text';
    if (field.placeholder) control.setAttribute('placeholder', String(field.placeholder));
    if (field.maxlength && Number.isFinite(+field.maxlength)) control.setAttribute('maxlength', String(+field.maxlength));
    if (initialValue != null) control.value = String(initialValue);
    control.className = 'sdoc-form-input';
    label.setAttribute('for', controlId(field.name));
    control.id = controlId(field.name);
    control.setAttribute('data-field-name', field.name);
    wrap.appendChild(control);
  } else if (field.type === 'textarea') {
    control = document.createElement('textarea');
    control.className = 'sdoc-form-textarea';
    control.id = controlId(field.name);
    label.setAttribute('for', controlId(field.name));
    control.setAttribute('data-field-name', field.name);
    if (field.placeholder) control.setAttribute('placeholder', String(field.placeholder));
    if (field.rows && Number.isFinite(+field.rows)) control.setAttribute('rows', String(+field.rows));
    else control.setAttribute('rows', '4');
    if (field.maxlength && Number.isFinite(+field.maxlength)) control.setAttribute('maxlength', String(+field.maxlength));
    if (initialValue != null) control.value = String(initialValue);
    wrap.appendChild(control);
  } else if (field.type === 'radio') {
    control = document.createElement('div');
    control.className = 'sdoc-form-radio-group';
    control.setAttribute('role', 'radiogroup');
    (field.options || []).forEach(function (opt, idx) {
      var line = document.createElement('label');
      line.className = 'sdoc-form-radio-line';
      var input = document.createElement('input');
      input.type = 'radio';
      input.name = field.name;
      input.value = String(opt);
      input.setAttribute('data-field-name', field.name);
      input.id = controlId(field.name) + '-' + idx;
      if (initialValue != null && String(opt) === String(initialValue)) input.checked = true;
      var span = document.createElement('span');
      span.textContent = String(opt);
      line.appendChild(input);
      line.appendChild(span);
      control.appendChild(line);
    });
    wrap.appendChild(control);
  } else if (field.type === 'checkbox') {
    control = document.createElement('div');
    control.className = 'sdoc-form-checkbox-group';
    control.setAttribute('role', 'group');
    var checkedSet = {};
    if (Array.isArray(initialValue)) {
      initialValue.forEach(function (v) { checkedSet[String(v)] = true; });
    }
    (field.options || []).forEach(function (opt, idx) {
      var line = document.createElement('label');
      line.className = 'sdoc-form-checkbox-line';
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.value = String(opt);
      input.setAttribute('data-field-name', field.name);
      input.id = controlId(field.name) + '-' + idx;
      if (checkedSet[String(opt)]) input.checked = true;
      var span = document.createElement('span');
      span.textContent = String(opt);
      line.appendChild(input);
      line.appendChild(span);
      control.appendChild(line);
    });
    wrap.appendChild(control);
  } else if (field.type === 'select') {
    control = document.createElement('select');
    control.className = 'sdoc-form-select';
    control.id = controlId(field.name);
    label.setAttribute('for', controlId(field.name));
    control.setAttribute('data-field-name', field.name);
    if (!field.required) {
      // A blank first option lets the user pick "nothing". For required
      // selects we omit it and the first option becomes the initial value.
      var blank = document.createElement('option');
      blank.value = '';
      blank.textContent = field.placeholder ? String(field.placeholder) : '';
      control.appendChild(blank);
    }
    (field.options || []).forEach(function (opt) {
      var o = document.createElement('option');
      o.value = String(opt);
      o.textContent = String(opt);
      if (initialValue != null && String(opt) === String(initialValue)) o.selected = true;
      control.appendChild(o);
    });
    wrap.appendChild(control);
  } else if (field.type === 'number') {
    control = document.createElement('input');
    control.type = 'number';
    control.className = 'sdoc-form-input sdoc-form-input-number';
    control.id = controlId(field.name);
    label.setAttribute('for', controlId(field.name));
    control.setAttribute('data-field-name', field.name);
    if (field.placeholder) control.setAttribute('placeholder', String(field.placeholder));
    if (field.min != null && Number.isFinite(+field.min)) control.setAttribute('min', String(+field.min));
    if (field.max != null && Number.isFinite(+field.max)) control.setAttribute('max', String(+field.max));
    if (field.step != null && Number.isFinite(+field.step)) control.setAttribute('step', String(+field.step));
    if (initialValue != null && initialValue !== '') control.value = String(initialValue);
    wrap.appendChild(control);
  } else if (field.type === 'date') {
    control = document.createElement('input');
    control.type = 'date';
    control.className = 'sdoc-form-input sdoc-form-input-date';
    control.id = controlId(field.name);
    label.setAttribute('for', controlId(field.name));
    control.setAttribute('data-field-name', field.name);
    if (field.min != null) control.setAttribute('min', String(field.min));
    if (field.max != null) control.setAttribute('max', String(field.max));
    if (initialValue != null && initialValue !== '') control.value = String(initialValue);
    wrap.appendChild(control);
  }

  if (field.help) {
    var help = document.createElement('div');
    help.className = 'sdoc-form-help';
    help.textContent = String(field.help);
    wrap.appendChild(help);
  }

  var err = document.createElement('div');
  err.className = 'sdoc-form-error-text';
  err.hidden = true;
  wrap.appendChild(err);

  return wrap;
}

function renderButton(buttonSpec, block, form, token) {
  // The submit row holds the button itself plus a small grey hint line
  // explaining what happens when the user clicks it. The hint comes from
  // the agent's optional `help:` key, or is auto-generated from the
  // button's `final`/`scope` shape so users always get some context.
  var wrap = document.createElement('span');
  wrap.className = 'sdoc-form-button-cell';

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sdoc-form-submit';
  var originalLabel = String(buttonSpec.label || buttonSpec.name);
  btn.textContent = originalLabel;
  btn.setAttribute('data-button-name', buttonSpec.name);
  btn.setAttribute('data-button-label', originalLabel);
  if (buttonSpec.final) btn.setAttribute('data-final', 'true');
  btn.addEventListener('click', function () {
    if (btn.disabled) return;
    setButtonState(btn, 'sending');
    handleSubmit(form, block, buttonSpec, token);
  });
  wrap.appendChild(btn);

  var hint = document.createElement('div');
  hint.className = 'sdoc-form-button-hint';
  hint.textContent = buttonHintText(buttonSpec, block);
  wrap.appendChild(hint);

  return wrap;
}

function buttonHintText(buttonSpec, block) {
  if (buttonSpec.help && typeof buttonSpec.help === 'string') {
    return buttonSpec.help;
  }
  if (buttonSpec.final) {
    return 'Submitting hands off to the agent and ends this session.';
  }
  var scope = Array.isArray(buttonSpec.scope) ? buttonSpec.scope : null;
  if (scope && scope.length) {
    return 'Sends just these answers (' + scope.join(', ') + '). You can keep editing.';
  }
  return 'Sends all answers. You can keep editing.';
}

// Visual states the submit button can be in. We do it via classes so CSS
// owns the look; the JS only swaps state + label text.
function setButtonState(btn, state) {
  btn.classList.remove('is-sending', 'is-sent');
  var label = btn.getAttribute('data-button-label') || btn.textContent;
  if (state === 'sending') {
    btn.classList.add('is-sending');
    btn.disabled = true;
    btn.textContent = 'Sending…';
  } else if (state === 'sent') {
    btn.classList.add('is-sent');
    btn.disabled = true; // briefly, until idle revert
    btn.textContent = '✓ Sent';
  } else {
    btn.disabled = false;
    btn.textContent = label;
  }
}

// ─── Submit gather + validate + dispatch ──────────────────────

function handleSubmit(form, block, buttonSpec, token) {
  // Determine in-scope field names.
  var scope = Array.isArray(buttonSpec.scope) && buttonSpec.scope.length
    ? buttonSpec.scope
    : block.fields.map(function (f) { return f.name; });

  // Gather values + run required-checks.
  var values = {};
  var firstInvalid = null;
  for (var i = 0; i < block.fields.length; i++) {
    var f = block.fields[i];
    if (scope.indexOf(f.name) < 0) continue;
    var v = readField(form, f);
    if (f.required && isEmptyValue(v)) {
      markFieldError(form, f.name, (f.label || f.name) + ' is required');
      if (!firstInvalid) firstInvalid = f.name;
    } else {
      clearFieldError(form, f.name);
    }
    values[f.name] = v;
  }
  if (firstInvalid) {
    var fSel = '[data-field="' + cssAttr(firstInvalid) + '"]';
    var first = form.querySelector(fSel + ' input, ' + fSel + ' textarea, ' + fSel + ' select');
    if (first) first.focus();
    return;
  }

  // Dispatch a custom event the bridge listens for. The bridge owns the
  // actual WebSocket plumbing.
  var ev;
  try {
    ev = new CustomEvent('sdocs-form-submit', {
      bubbles: true,
      detail: {
        formId: block.id,
        buttonName: buttonSpec.name,
        values: values,
        scope: scope,
        token: token,
        final: !!buttonSpec.final,
      },
    });
  } catch (_) {
    ev = document.createEvent('Event');
    ev.initEvent('sdocs-form-submit', true, false);
    ev.detail = {
      formId: block.id,
      buttonName: buttonSpec.name,
      values: values,
      scope: scope,
      token: token,
      final: !!buttonSpec.final,
    };
  }
  form.dispatchEvent(ev);
}

function readField(form, field) {
  if (field.type === 'radio') {
    var checked = form.querySelector('input[type="radio"][name="' + cssAttr(field.name) + '"]:checked');
    return checked ? checked.value : null;
  }
  if (field.type === 'checkbox') {
    var boxes = form.querySelectorAll('input[type="checkbox"][data-field-name="' + cssAttr(field.name) + '"]');
    var values = [];
    for (var i = 0; i < boxes.length; i++) {
      if (boxes[i].checked) values.push(boxes[i].value);
    }
    return values;
  }
  if (field.type === 'select') {
    var sel = form.querySelector('select[data-field-name="' + cssAttr(field.name) + '"]');
    return sel ? sel.value : '';
  }
  if (field.type === 'number') {
    var num = form.querySelector('input[type="number"][data-field-name="' + cssAttr(field.name) + '"]');
    if (!num || num.value === '') return null;
    var n = Number(num.value);
    return Number.isFinite(n) ? n : null;
  }
  if (field.type === 'date') {
    var d = form.querySelector('input[type="date"][data-field-name="' + cssAttr(field.name) + '"]');
    return d ? d.value : '';
  }
  if (field.type === 'textarea') {
    var ta = form.querySelector('textarea[data-field-name="' + cssAttr(field.name) + '"]');
    return ta ? ta.value : '';
  }
  // text
  var inp = form.querySelector('input[data-field-name="' + cssAttr(field.name) + '"]');
  return inp ? inp.value : '';
}

function isEmptyValue(v) {
  if (v == null) return true;
  if (v === '') return true;
  if (Array.isArray(v) && v.length === 0) return true;
  return false;
}

function markFieldError(form, fieldName, msg) {
  var row = form.querySelector('[data-field="' + cssAttr(fieldName) + '"]');
  if (!row) return;
  var err = row.querySelector('.sdoc-form-error-text');
  if (err) { err.textContent = msg; err.hidden = false; }
  row.classList.add('sdoc-form-field-invalid');
}

function clearFieldError(form, fieldName) {
  var row = form.querySelector('[data-field="' + cssAttr(fieldName) + '"]');
  if (!row) return;
  var err = row.querySelector('.sdoc-form-error-text');
  if (err) { err.textContent = ''; err.hidden = true; }
  row.classList.remove('sdoc-form-field-invalid');
}

// ─── Helpers ──────────────────────────────────────────────────

function controlId(fieldName) {
  return 'sdoc-form-field-' + fieldName;
}

function cssAttr(s) {
  // The field/button name regex already excludes quote-confusable chars,
  // so a plain pass-through is safe. We keep this helper as a single
  // chokepoint in case the regex evolves.
  return String(s).replace(/["\\]/g, '\\$&');
}

// ─── Bridge event hookup ──────────────────────────────────────
//
// The bridge dispatches `sdocs-form-submitted` after the server acks a
// submit, and `sdocs-form-session-ended` after a final submit (or any
// submit in single-shot mode). We listen at the document level once so
// hot re-renders don't multiply listeners.

document.addEventListener('sdocs-form-submitted', function (e) {
  var d = (e && e.detail) || {};
  if (!d.buttonName) return;
  var btn = document.querySelector('.sdoc-form button[data-button-name="' + cssAttr(d.buttonName) + '"]');
  if (!btn) return;
  setButtonState(btn, 'sent');
  // Brief confirmation, then revert (unless the session is ending — in
  // which case the lock will overwrite this momentarily).
  setTimeout(function () {
    if (!btn.classList.contains('is-locked')) setButtonState(btn, 'idle');
  }, 1200);
});

document.addEventListener('sdocs-form-session-ended', function () {
  var forms = document.querySelectorAll('.sdoc-form');
  for (var i = 0; i < forms.length; i++) lockForm(forms[i]);
});

function lockForm(form) {
  if (form.classList.contains('sdoc-form-locked')) return;
  form.classList.add('sdoc-form-locked');
  // Disable every interactive control in this form.
  var ctrls = form.querySelectorAll('input, textarea, select, button');
  for (var i = 0; i < ctrls.length; i++) {
    var c = ctrls[i];
    c.disabled = true;
    if (c.tagName === 'BUTTON') c.classList.add('is-locked');
  }
  // Append a small status line so the user knows their listener is gone.
  if (!form.querySelector('.sdoc-form-ended-note')) {
    var note = document.createElement('div');
    note.className = 'sdoc-form-ended-note';
    note.textContent = 'Session ended. The agent has the final answers.';
    form.appendChild(note);
  }
}

// ─── Expose for orchestrator ──────────────────────────────────

S.renderForms = renderForms;
S.formsInternals = { mountForm: mountForm, setButtonState: setButtonState, lockForm: lockForm };

}());
