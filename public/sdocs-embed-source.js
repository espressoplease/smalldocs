// Generic parent-frame document source for embedded SmallDocs.
//
// The frame has no credentials and performs no persistence itself. A host
// page provides the document and handles save/review messages through a
// versioned postMessage protocol. The random channel in the URL fragment
// binds every message to one iframe instance.
(function () {
  'use strict';
  if (typeof window === 'undefined' || window.parent === window) return;

  var S = window.SDocs;
  if (!S || !S.Sources) return;

  var SCOPE = 'sdocs-embed';
  var VERSION = 1;
  var MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
  var MAX_LABEL_BYTES = 2048;
  var CHANNEL_RE = /^[A-Za-z0-9_-]{16,128}$/;

  function configFromLocation(loc) {
    var raw = (loc && loc.hash) || '';
    if (raw.charAt(0) === '#') raw = raw.slice(1);
    var params;
    try { params = new URLSearchParams(raw); }
    catch (_) { return null; }
    if (params.get('embed') !== '1') return null;
    var channel = params.get('channel') || '';
    if (!CHANNEL_RE.test(channel)) return null;
    return { channel: channel };
  }

  function fullDocument() {
    if (typeof S.serializeCurrentDocument === 'function') {
      return S.serializeCurrentDocument();
    }
    var body = S.currentBody != null ? S.currentBody : '';
    var meta = Object.assign({}, S.currentMeta || {});
    if (Object.keys(meta).length === 0) return body;
    return SDocYaml.serializeFrontMatter(meta) + '\n' + body;
  }

  function boundedString(value, max) {
    return typeof value === 'string' && value.length <= max ? value : null;
  }

  function capabilities(value) {
    value = value && typeof value === 'object' ? value : {};
    return {
      canSave: value.canSave !== false,
      canWatch: value.canWatch !== false,
      canSubmit: value.canSubmit === true,
    };
  }

  function EmbedSource(cfg) {
    this.name = 'embed';
    this.cfg = cfg;
    this.capabilities = { canSave: false, canWatch: false, canSubmit: false };
    this.status = 'connecting';
    this.statusLabel = 'Waiting for host';
    this.message = null;
    this.submitLabel = 'Done';
    this.formSubmitMode = 'draft';
    this._connected = false;
    this._initialized = false;
    this._submitted = false;
    this._submitting = false;
    this._sequence = 0;
    this._lastAcknowledgedSequence = 0;
    this._lastAcknowledgedDocument = null;
    this._lastQueuedDocument = null;
    this._saveTimer = null;
    this._pendingFormAck = null;
    this._formAcks = {};
    this._dirty = false;
    this._onWindowMessage = this._onWindowMessage.bind(this);
    this._onFormSubmit = this._onFormSubmit.bind(this);
    this._resolveLoad = null;
    this._loadPromise = new Promise(function (resolve) {
      this._resolveLoad = resolve;
    }.bind(this));

    S.embedMode = true;
    S.disableShortLinks = true;
    S.bridge = this;
  }

  EmbedSource.prototype._post = function (type, payload) {
    window.parent.postMessage({
      scope: SCOPE,
      version: VERSION,
      channel: this.cfg.channel,
      type: type,
      payload: payload || {},
    }, '*');
  };

  EmbedSource.prototype._setStatus = function (status, label) {
    this.status = status;
    this.statusLabel = label || null;
    if (S.setStatus && label) {
      var kind = status === 'error' || status === 'conflict' ? 'error' : undefined;
      S.setStatus(label, kind);
    }
    if (S.renderFileInfoCard) S.renderFileInfoCard();
  };

  EmbedSource.prototype._setDirty = function (dirty) {
    dirty = dirty === true;
    if (this._dirty === dirty) return;
    this._dirty = dirty;
    this._post('dirty-state', { dirty: dirty });
  };

  EmbedSource.prototype.load = function () {
    window.addEventListener('message', this._onWindowMessage);
    document.addEventListener('sdocs-form-submit', this._onFormSubmit);
    this._post('ready', {});
    return this._loadPromise;
  };

  EmbedSource.prototype.dispose = function () {
    window.removeEventListener('message', this._onWindowMessage);
    document.removeEventListener('sdocs-form-submit', this._onFormSubmit);
    if (this._saveTimer) clearTimeout(this._saveTimer);
  };

  EmbedSource.prototype._validEnvelope = function (event) {
    if (!event || event.source !== window.parent) return null;
    var msg = event.data;
    if (!msg || typeof msg !== 'object') return null;
    if (msg.scope !== SCOPE || msg.version !== VERSION ||
        msg.channel !== this.cfg.channel || typeof msg.type !== 'string') return null;
    return msg;
  };

  EmbedSource.prototype._onWindowMessage = function (event) {
    var msg = this._validEnvelope(event);
    if (!msg) return;
    if (msg.type === 'init') return this._onInit(msg.payload);
    if (!this._initialized) return;
    if (msg.type === 'save-result') return this._onSaveResult(msg.payload);
    if (msg.type === 'save-conflict') return this._onSaveConflict(msg.payload);
    if (msg.type === 'save-error') return this._onSaveError(msg.payload);
    if (msg.type === 'submit-result') return this._onSubmitResult(msg.payload);
    if (msg.type === 'submit-error') return this._onSubmitError(msg.payload);
    if (msg.type === 'replace-document') return this._onReplaceDocument(msg.payload);
  };

  EmbedSource.prototype._onInit = function (payload) {
    if (this._initialized || !payload || typeof payload !== 'object') return;
    var content = boundedString(payload.content, MAX_DOCUMENT_BYTES);
    var file = boundedString(payload.file || 'untitled.md', 512);
    if (content == null || file == null) {
      this._setStatus('error', 'Host sent an invalid document.');
      return;
    }

    this.capabilities = capabilities(payload.capabilities);
    this.message = boundedString(payload.message || '', MAX_LABEL_BYTES) || null;
    this.submitLabel = boundedString(payload.submitLabel || '', 80) || 'Done';
    this.formSubmitMode = payload.formSubmitMode === 'direct' ? 'direct' : 'draft';
    this._connected = true;
    this._initialized = true;
    this.cfg.file = file;
    S._isDefaultState = false;
    S.loadText(content, file);

    var allowedModes = ['read', 'style', 'write', 'raw', 'export', 'info', 'comment'];
    var mode = allowedModes.indexOf(payload.mode) >= 0 ? payload.mode : 'read';
    S.setMode(mode, true);
    this._lastAcknowledgedDocument = fullDocument();
    this._setDirty(false);
    this._setStatus('saved', 'Loaded from host');
    if (this._resolveLoad) {
      this._resolveLoad();
      this._resolveLoad = null;
    }
  };

  EmbedSource.prototype.save = function (content) {
    if (!this._initialized || !this.capabilities.canSave || this._submitted) return;
    this._queueSave(typeof content === 'string' ? content : fullDocument());
  };

  EmbedSource.prototype._queueSave = function (content) {
    this._lastQueuedDocument = content;
    this._setDirty(true);
    if (this._saveTimer) clearTimeout(this._saveTimer);
    var self = this;
    this._saveTimer = setTimeout(function () {
      self._sendQueuedSave();
    }, 500);
    this._setStatus('saving', 'Unsaved changes');
  };

  EmbedSource.prototype._sendQueuedSave = function () {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    var content = this._lastQueuedDocument;
    this._lastQueuedDocument = null;
    if (typeof content !== 'string' || content === this._lastAcknowledgedDocument) return null;
    var sequence = ++this._sequence;
    if (this._pendingFormAck) {
      this._formAcks[sequence] = this._pendingFormAck;
      this._pendingFormAck = null;
    }
    this._post('document-changed', { sequence: sequence, content: content });
    this._setStatus('saving', 'Saving...');
    return sequence;
  };

  EmbedSource.prototype._onSaveResult = function (payload) {
    payload = payload && typeof payload === 'object' ? payload : {};
    var sequence = Number(payload.sequence);
    if (!Number.isInteger(sequence) || sequence <= this._lastAcknowledgedSequence) return;
    this._lastAcknowledgedSequence = sequence;
    if (typeof payload.content === 'string') {
      this._lastAcknowledgedDocument = payload.content;
    } else if (this._lastQueuedDocument == null) {
      this._lastAcknowledgedDocument = fullDocument();
    }
    this._setStatus('saved', this._lastQueuedDocument == null ? 'Saved' : 'Saving...');
    this._setDirty(
      this._lastQueuedDocument != null ||
      this._lastAcknowledgedSequence < this._sequence
    );

    var ack = this._formAcks[sequence];
    if (ack) {
      delete this._formAcks[sequence];
      document.dispatchEvent(new CustomEvent('sdocs-form-submitted', {
        bubbles: true,
        detail: {
          formId: ack.formId,
          buttonName: ack.buttonName,
          token: ack.token || '',
          file: this.cfg.file || 'the document',
        },
      }));
    }
  };

  EmbedSource.prototype._onSaveConflict = function () {
    this._setDirty(true);
    this._setStatus('conflict', 'The document changed outside this editor.');
  };

  EmbedSource.prototype._onSaveError = function (payload) {
    var message = payload && typeof payload.message === 'string'
      ? payload.message
      : 'Could not save changes.';
    this._setDirty(true);
    this._setStatus('error', message);
  };

  EmbedSource.prototype._onReplaceDocument = function (payload) {
    if (!payload || typeof payload !== 'object') return;
    var content = boundedString(payload.content, MAX_DOCUMENT_BYTES);
    if (content == null) return;
    S.loadText(content, boundedString(payload.file || this.cfg.file || 'untitled.md', 512) || 'untitled.md');
    this._lastQueuedDocument = null;
    this._lastAcknowledgedDocument = fullDocument();
    this._lastAcknowledgedSequence = this._sequence;
    this._setDirty(false);
    this._setStatus('saved', 'Reloaded from host');
  };

  EmbedSource.prototype._onFormSubmit = function (event) {
    if (!this._initialized || this._submitted || this.formSubmitMode !== 'draft') return;
    var detail = event && event.detail;
    if (!detail || !detail.formId || !detail.buttonName) return;
    var result = this._persistFormDraft(detail);
    if (!result.ok) {
      this._setStatus('error', result.error || 'Could not save the form answer.');
      return;
    }
    this._pendingFormAck = detail;
    S.syncAll('form');
  };

  EmbedSource.prototype._persistFormDraft = function (detail) {
    var FB = window.SDocFormBlock;
    if (!FB || typeof FB.findFormBlocks !== 'function' || typeof FB.spliceFormBlock !== 'function') {
      return { ok: false, error: 'Form persistence is unavailable.' };
    }
    var body = S.currentBody != null ? S.currentBody : '';
    var blocks = FB.findFormBlocks(body);
    var target = null;
    for (var i = 0; i < blocks.length; i++) {
      if (blocks[i].id === detail.formId) {
        target = blocks[i];
        break;
      }
    }
    if (!target || target.error || !target.parsed) {
      return { ok: false, error: 'The form is no longer present in the document.' };
    }
    var token = FB.formRevisionToken(target.parsed.fields, target.parsed.buttons);
    if (detail.token && token !== detail.token) {
      return { ok: false, error: 'The form changed while you were editing.' };
    }

    var known = {};
    target.parsed.fields.forEach(function (field) { known[field.name] = true; });
    var values = detail.values && typeof detail.values === 'object' ? detail.values : {};
    var answers = Object.assign({}, target.parsed.answers || {});
    var scoped = {};
    Object.keys(values).forEach(function (key) {
      if (!known[key]) return;
      answers[key] = values[key];
      scoped[key] = values[key];
    });

    var next = {
      id: target.parsed.id,
      fields: target.parsed.fields,
      buttons: target.parsed.buttons,
      answers: answers,
      submissions: (target.parsed.submissions || []).slice(),
    };
    next.submissions.push({
      by: detail.buttonName,
      at: new Date().toISOString(),
      scope: Array.isArray(detail.scope) && detail.scope.length
        ? detail.scope
        : target.parsed.fields.map(function (field) { return field.name; }),
      values: scoped,
    });
    var spliced = FB.spliceFormBlock(body, target, next);
    if (spliced.error) return { ok: false, error: spliced.error };
    S.currentBody = spliced.doc;
    if (S.rawEl) {
      S.rawEl.value = Object.keys(S.currentMeta || {}).length
        ? SDocYaml.serializeFrontMatter(S.currentMeta || {}) + '\n' + S.currentBody
        : S.currentBody;
    }
    return { ok: true };
  };

  EmbedSource.prototype.submit = function () {
    if (!this._initialized || !this.capabilities.canSubmit ||
        this._submitted || this._submitting) return;
    var collected = window.SDocForms && typeof window.SDocForms.collectAll === 'function'
      ? window.SDocForms.collectAll({ validateRequired: true })
      : { ok: true, forms: [] };
    if (!collected.ok) {
      this._setStatus('error', 'Fill the required form fields before sending.');
      return;
    }
    if (this._saveTimer) this._sendQueuedSave();
    var sequence = this._sequence;
    this._submitting = true;
    if (S.renderFileInfoCard) S.renderFileInfoCard();
    this._setStatus('saving', 'Sending review...');
    this._post('submit-review', {
      sequence: sequence,
      content: fullDocument(),
      forms: collected.forms || [],
    });
  };

  EmbedSource.prototype._onSubmitResult = function () {
    this._submitting = false;
    this._submitted = true;
    this._setDirty(false);
    this._setStatus('submitted', 'Review sent');
    document.dispatchEvent(new CustomEvent('sdocs-form-session-ended', { bubbles: true }));
  };

  EmbedSource.prototype._onSubmitError = function (payload) {
    this._submitting = false;
    var message = payload && typeof payload.message === 'string'
      ? payload.message
      : 'Could not send the review.';
    this._setStatus('error', message);
  };

  S.Sources.register({
    name: 'embed',
    matches: function (loc) { return configFromLocation(loc) != null; },
    create: function (loc) { return new EmbedSource(configFromLocation(loc)); },
  });

  S.embedInternals = {
    configFromLocation: configFromLocation,
    EmbedSource: EmbedSource,
    scope: SCOPE,
    version: VERSION,
  };
}());
