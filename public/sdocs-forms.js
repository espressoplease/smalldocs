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
  var src = codeEl.textContent || '';
  var parsed = FB.parseFormBlock(src);
  var host = document.createElement('div');
  host.className = 'sdoc-form-host';
  if (parsed.error) {
    renderError(host, parsed.error, src);
    pre.replaceWith(host);
    return;
  }
  renderForm(host, parsed.value);
  pre.replaceWith(host);
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

  // Render each field. A field is { name, type, label, help, required,
  // default, placeholder, options, rows, maxlength }.
  block.fields.forEach(function (f) {
    var initial = (block.answers && Object.prototype.hasOwnProperty.call(block.answers, f.name))
      ? block.answers[f.name]
      : f.default;
    form.appendChild(renderField(f, initial));
  });

  // Buttons.
  var btnRow = document.createElement('div');
  btnRow.className = 'sdoc-form-buttons';
  block.buttons.forEach(function (b) {
    btnRow.appendChild(renderButton(b, block, form, token));
  });
  form.appendChild(btnRow);

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
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sdoc-form-submit';
  btn.textContent = String(buttonSpec.label || buttonSpec.name);
  btn.setAttribute('data-button-name', buttonSpec.name);
  if (buttonSpec.final) btn.setAttribute('data-final', 'true');
  btn.addEventListener('click', function () {
    handleSubmit(form, block, buttonSpec, token);
  });
  return btn;
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
    if (f.required && (v == null || v === '')) {
      markFieldError(form, f.name, (f.label || f.name) + ' is required');
      if (!firstInvalid) firstInvalid = f.name;
    } else {
      clearFieldError(form, f.name);
    }
    values[f.name] = v;
  }
  if (firstInvalid) {
    var first = form.querySelector('[data-field="' + cssAttr(firstInvalid) + '"] input, [data-field="' + cssAttr(firstInvalid) + '"] textarea');
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
  if (field.type === 'textarea') {
    var ta = form.querySelector('textarea[data-field-name="' + cssAttr(field.name) + '"]');
    return ta ? ta.value : '';
  }
  // text
  var inp = form.querySelector('input[data-field-name="' + cssAttr(field.name) + '"]');
  return inp ? inp.value : '';
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

// ─── Expose for orchestrator ──────────────────────────────────

S.renderForms = renderForms;
S.formsInternals = { mountForm: mountForm };

}());
