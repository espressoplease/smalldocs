/* Browser-only dictation. Comment mode prepares the model; a deliberate press requests the microphone. */
(function () {
'use strict';
var S = window.SDocs;
var assetQuery = new URL(document.currentScript.src).search;
var worker = null, pending = new Map(), sequence = 0, active = null, observer = null;
var ready = null, modelState = 'idle', loadedMB = 0, inMode = false, gesture = null;
var bindings = new WeakMap(), savedBindings = new WeakMap(), holdTargets = new WeakSet();
var MIC = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></svg>';
var STOP = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';

function text(element, value) { if (element.textContent !== value) element.textContent = value; }
function paintModelState() {
  var toolbar = document.querySelector('#_sd_comment-toolbar .sdoc-context-tools-inner');
  if (!toolbar) return;
  var label = document.getElementById('_sd_comment-voice-state');
  if (!label) {
    label = document.createElement('span');
    label.id = '_sd_comment-voice-state'; label.className = 'sdoc-comment-voice-state';
    label.setAttribute('role', 'status');
    label.title = 'Voice runs on this device. The first model download is about 100 MB.';
    toolbar.appendChild(label);
  }
  text(label, modelState === 'ready' ? 'Voice ready' : modelState === 'error' ? 'Voice unavailable. You can type.' :
    modelState === 'loading' ? 'Preparing voice' + (loadedMB ? ': ' + loadedMB + ' MB' : '...') : '');
}
function request(type, audio) {
  if (!worker) {
    worker = new Worker('/public/sdocs-comment-speech-worker.js' + assetQuery);
    worker.onmessage = function (event) {
      var message = event.data;
      if (message.type === 'progress') { loadedMB = message.loadedMB || 0; paintModelState(); return; }
      var item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id);
      if (message.type === 'error') item.reject(new Error(message.message));
      else item.resolve(message);
    };
    worker.onerror = function () { releaseWorker(); if (inMode) { modelState = 'error'; paintModelState(); } };
  }
  return new Promise(function (resolve, reject) {
    var id = ++sequence;
    pending.set(id, { resolve: resolve, reject: reject });
    worker.postMessage({ type: type, id: id, audio: audio }, audio ? [audio.buffer] : []);
  });
}
function prepare() {
  if (ready) return ready;
  modelState = 'loading'; loadedMB = 0; paintModelState();
  var job = request('load').then(function () {
    if (ready === job) { modelState = 'ready'; paintModelState(); }
  }).catch(function (error) {
    if (ready === job) { ready = null; modelState = 'error'; paintModelState(); }
    throw error;
  });
  ready = job;
  return job;
}
function releaseWorker() {
  ready = null;
  if (worker) worker.terminate();
  worker = null;
  pending.forEach(function (item) { item.reject(new Error('Speech recognition stopped.')); });
  pending.clear();
}
function status(session, value) { text(session.binding.hint, value); }
function stopTracks(session) {
  if (session.stream) session.stream.getTracks().forEach(function (track) { track.stop(); });
  session.stream = null;
}
function idleButton(button, append) {
  button.innerHTML = MIC + '<span>Hold to speak</span>';
  button.setAttribute('aria-label', append ? 'Add to comment by voice' : 'Dictate comment');
  button.title = append ? 'Hold to add to this comment, or click to start and stop. Review the text before saving.' :
    'Hold to speak, or click to start and stop. Audio stays on this device.';
  button.setAttribute('aria-pressed', 'false'); button.disabled = false;
}
function finish(session) {
  stopTracks(session);
  if (session.context) session.context.close().catch(function () {});
  idleButton(session.binding.button, session.binding.append);
  session.binding.card.classList.remove('is-recording');
  if (active === session) active = null;
}
function cancel() {
  if (!active) return;
  var session = active; active = null;
  if (session.hold) session.hold.held = false;
  if (session.recorder && session.recorder.state !== 'inactive') session.recorder.stop();
  if (session.state === 'transcribing') releaseWorker();
  status(session, ''); finish(session);
}
function stop(session) {
  if (!session || session.state !== 'recording') return;
  session.state = 'transcribing'; session.binding.button.disabled = true;
  session.binding.card.classList.remove('is-recording');
  session.recorder.stop(); stopTracks(session);
  status(session, modelState === 'ready' ? 'Transcribing on this device...' : 'Preparing voice for your recording...');
}
async function transcribe(session, chunks) {
  try {
    if (!chunks.length) { status(session, 'No speech recorded. Hold again to speak.'); return; }
    var audio = await session.context.decodeAudioData(await new Blob(chunks, { type: session.recorder.mimeType }).arrayBuffer());
    if (active !== session) return;
    var mono = new Float32Array(audio.length);
    for (var channel = 0; channel < audio.numberOfChannels; channel++) {
      var samples = audio.getChannelData(channel);
      for (var i = 0; i < mono.length; i++) mono[i] += samples[i] / audio.numberOfChannels;
    }
    await prepare();
    if (active !== session) return;
    status(session, 'Transcribing on this device...');
    var result = await request('transcribe', mono);
    var input = session.binding.input;
    if (active !== session || !input.isConnected) return;
    if (result.text) {
      var position = session.binding.append || input.selectionStart == null ? input.value.length : input.selectionStart;
      var end = session.binding.append || input.selectionEnd == null ? position : input.selectionEnd;
      var before = input.value.slice(0, position), after = input.value.slice(end);
      var insertion = (before && !/\s$/.test(before) ? ' ' : '') + result.text + (after && !/^\s/.test(after) ? ' ' : '');
      input.setRangeText(insertion, position, end, 'end');
      input.dispatchEvent(new Event('input', { bubbles: true })); input.focus();
      status(session, 'Review the text before saving.');
    } else status(session, 'No speech recognized. Hold again to speak.');
  } catch (error) {
    if (active === session) status(session, 'Could not transcribe this recording. You can try again or type.');
  } finally { if (active === session) finish(session); }
}
async function begin(binding, hold) {
  if (!hold && active && active.binding === binding) {
    if (active.state === 'recording') stop(active); else cancel();
    return;
  }
  cancel();
  if (binding.append) {
    var input = S.commentsUi.prepareCommentAppend(binding.card);
    if (!input) return;
    bindInput(binding, input);
  }
  var session = { binding: binding, hold: hold, state: 'permission' }; active = session;
  binding.button.setAttribute('aria-label', 'Cancel dictation'); binding.button.title = 'Cancel dictation';
  binding.button.setAttribute('aria-pressed', 'true'); status(session, 'Allow microphone access to speak.');
  prepare().catch(function () {});
  try {
    session.context = new AudioContext({ sampleRate: 16000 });
    await session.context.resume();
    if (active !== session) return;
    var stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    if (active !== session || !binding.input.isConnected) { stream.getTracks().forEach(function (track) { track.stop(); }); return; }
    session.stream = stream;
    if (hold && !hold.held) { status(session, 'Microphone ready. Hold again to speak.'); finish(session); return; }
    var chunks = [];
    session.recorder = new MediaRecorder(stream);
    session.recorder.ondataavailable = function (event) { if (event.data.size) chunks.push(event.data); };
    session.recorder.onerror = function () {
      if (active === session) { status(session, 'Recording failed. You can try again or type.'); finish(session); }
    };
    session.recorder.onstop = function () {
      if (active !== session) return;
      session.state = 'transcribing'; binding.button.disabled = true;
      binding.card.classList.remove('is-recording'); stopTracks(session); transcribe(session, chunks);
    };
    session.state = 'recording'; session.recorder.start();
    binding.button.innerHTML = STOP + '<span>' + (hold ? 'Release to finish' : 'Stop recording') + '</span>';
    binding.button.setAttribute('aria-label', 'Stop dictation');
    binding.button.title = hold ? 'Release to finish recording' : 'Stop dictation';
    binding.card.classList.add('is-recording');
    status(session, hold ? 'Speak now. Release to finish.' : 'Recording on this device. Select Stop recording when finished.');
  } catch (error) {
    if (active === session) {
      status(session, error.name === 'NotAllowedError' ? 'Allow microphone access in your browser to speak.' : 'Could not start recording. You can try again or type.');
      finish(session);
    }
  }
}
function restoreHold(hold) {
  clearTimeout(hold.timer); hold.target.classList.remove('is-holding');
  if (hold.originalHTML) hold.target.innerHTML = hold.originalHTML;
}
function releaseHold(event, canceled) {
  if (!gesture || event && event.pointerId !== gesture.pointerId) return;
  var hold = gesture; gesture = null; hold.held = false; restoreHold(hold);
  if (hold.started && active && active.hold === hold) { if (canceled) cancel(); else stop(active); }
}
function bindHold(target, resolveBinding) {
  if (holdTargets.has(target)) return;
  holdTargets.add(target);
  target.addEventListener('pointerdown', function (event) {
    if (event.button !== 0 || !event.isPrimary) return;
    releaseHold(null, true);
    var hold = { target: target, pointerId: event.pointerId, x: event.clientX, y: event.clientY, held: true, started: false };
    gesture = hold;
    hold.timer = setTimeout(function () {
      if (!hold.held || !target.isConnected) return;
      hold.started = true;
      var binding = resolveBinding();
      if (!binding) return;
      target.classList.add('is-holding');
      if (target.matches('[data-dictation-target]')) { hold.originalHTML = target.innerHTML; target.innerHTML = MIC; }
      begin(binding, hold);
    }, 350);
    try { target.setPointerCapture(event.pointerId); } catch (_) {}
  });
  target.addEventListener('pointermove', function (event) {
    if (gesture && !gesture.started && (Math.abs(event.clientX - gesture.x) > 8 || Math.abs(event.clientY - gesture.y) > 8)) releaseHold(event, true);
  });
  target.addEventListener('lostpointercapture', function (event) { releaseHold(event, false); });
  target.addEventListener('click', function (event) {
    if (target.dataset.dictationHeld === 'true' && event.detail !== 0) {
      event.preventDefault(); event.stopImmediatePropagation(); delete target.dataset.dictationHeld;
    }
  }, true);
}
function grow(input) {
  if (window.CSS && CSS.supports('field-sizing', 'content')) { input.style.height = ''; return; }
  input.style.height = 'auto'; input.style.height = input.scrollHeight + 'px';
}
function resizeEditors() {
  document.querySelectorAll('textarea.sdoc-card-input, textarea.sdoc-cc-input').forEach(grow);
}
function createBinding(card, actions, append) {
  card.classList.add('sdoc-comment-editor');
  var button = document.createElement('button'); button.type = 'button';
  button.className = (card.classList.contains('sdoc-cc-card') ? 'sdoc-cc-iconbtn' : 'sdoc-icon-btn') + ' sdoc-dictation-btn';
  idleButton(button, append);
  var hint = document.createElement('span'); hint.className = 'sdoc-dictation-status'; hint.setAttribute('role', 'status');
  var binding = { input: null, card: card, button: button, hint: hint, append: append };
  button.addEventListener('click', function (event) { event.stopPropagation(); begin(binding, null); });
  actions.prepend(button); actions.insertAdjacentElement('beforebegin', hint);
  bindHold(button, function () { return binding; });
  return binding;
}
function bindInput(binding, input) {
  binding.input = input;
  if (!bindings.has(input)) {
    bindings.set(input, binding);
    input.placeholder = binding.card.classList.contains('sdoc-thread-composer') ? 'Type a reply, or hold to speak...' : 'Type a comment, or hold to speak...';
    input.addEventListener('input', function () { grow(input); });
    bindHold(input, function () { return binding; });
  }
  requestAnimationFrame(function () { if (input.isConnected) grow(input); });
}
function attach(input) {
  if (bindings.has(input) || input.readOnly || input.disabled) return;
  var card = input.closest('.sdoc-card, .sdoc-cc-card') || input.parentElement;
  var actions = card.querySelector('.sdoc-comment-editor-actions, .sdoc-cc-card-edit-actions');
  if (!actions) {
    actions = document.createElement('span'); actions.className = 'sdoc-comment-editor-actions';
    Array.prototype.slice.call(card.children).forEach(function (child) { if (child.matches('button')) actions.appendChild(child); });
    card.appendChild(actions);
  }
  bindInput(createBinding(card, actions, false), input);
}
function scan() {
  document.querySelectorAll('[data-dictation-comment]').forEach(function (card) {
    if (!savedBindings.has(card)) savedBindings.set(card, createBinding(card, card.querySelector('.sdoc-comment-view-actions'), true));
  });
  document.querySelectorAll('textarea.sdoc-card-input, textarea.sdoc-cc-input').forEach(attach);
  document.querySelectorAll('[data-dictation-target]').forEach(function (target) {
    target.title = 'Click to type a comment. Hold to speak.';
    bindHold(target, function () {
      target.click(); scan();
      var host = target.closest('.sdoc-block-host, .sdoc-element-host');
      var input = host && host.querySelector('.sdoc-card-edit .sdoc-card-input');
      return input && bindings.get(input);
    });
  });
  if (active && !active.binding.input.isConnected) cancel();
}
function onPointerUp(event) {
  if (gesture && gesture.started) {
    var target = gesture.target; target.dataset.dictationHeld = 'true';
    setTimeout(function () { delete target.dataset.dictationHeld; }, 0);
  }
  releaseHold(event, false);
}
function onPointerCancel(event) { releaseHold(event, true); }
function onWindowBlur() { releaseHold(null, false); }
function onContextMenu(event) { if (gesture && gesture.started) event.preventDefault(); }
function enter() {
  if (!navigator.mediaDevices || !window.MediaRecorder || !window.AudioContext) return;
  inMode = true;
  if (!observer) {
    observer = new MutationObserver(scan); observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', onPointerCancel, true);
    document.addEventListener('contextmenu', onContextMenu, true);
    window.addEventListener('blur', onWindowBlur);
    window.addEventListener('resize', resizeEditors);
  }
  scan(); prepare().catch(function () {});
}
function exit() {
  inMode = false; releaseHold(null, true); cancel(); releaseWorker();
  if (observer) observer.disconnect(); observer = null;
  document.removeEventListener('pointerup', onPointerUp, true);
  document.removeEventListener('pointercancel', onPointerCancel, true);
  document.removeEventListener('contextmenu', onContextMenu, true);
  window.removeEventListener('blur', onWindowBlur);
  window.removeEventListener('resize', resizeEditors);
  modelState = 'idle'; paintModelState();
}
S.commentDictation = { enter: enter, exit: exit, cancel: cancel };
if (document.body.classList.contains('comment-mode') || document.querySelector('.sdoc-cc-on, .sdoc-present-commenting')) enter();
})();
