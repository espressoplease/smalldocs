/* Browser-only speech recognition. Audio arrives as PCM and never leaves this worker. */
'use strict';
var SDocsSpeechImportMeta = { url: new URL('vendor/comment-speech/transformers.js', self.location.href).href };
var transcriber = null;
var loading = null;
var downloaded = {};

function load() {
  if (loading) return loading;
  loading = (async function () {
    importScripts(SDocsSpeechImportMeta.url);
    var engine = SDocsSpeechEngine;
    engine.env.allowLocalModels = false;
    engine.env.useBrowserCache = true;
    engine.env.backends.onnx.wasm.numThreads = 1;
    engine.env.backends.onnx.wasm.proxy = false;
    engine.env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/';
    var options = {
      revision: '27a07b4b52b3a4c5886134bb4320e93e1a4bbc7c',
      dtype: 'q8', device: 'wasm',
      progress_callback: function (event) {
        if (event.status === 'progress') {
          downloaded[event.file] = event.loaded || 0;
          var loaded = Object.keys(downloaded).reduce(function (sum, key) { return sum + downloaded[key]; }, 0);
          self.postMessage({ type: 'progress', loadedMB: Math.round(loaded / 1000000) });
        }
      },
    };
    // The quantized model is tested with WASM. GPU inference needs a separate
    // accuracy check: the q8 encoder produced corrupt output on Apple Metal.
    transcriber = await engine.pipeline('automatic-speech-recognition', 'onnx-community/whisper-base', options);
    return transcriber;
  })().catch(function (error) { loading = null; throw error; });
  return loading;
}

self.onmessage = async function (event) {
  var message = event.data;
  try {
    var pipe = await load();
    if (message.type === 'load') self.postMessage({ type: 'ready', id: message.id });
    else if (message.type === 'transcribe') {
      var result = await pipe(message.audio, { chunk_length_s: 30, stride_length_s: 5, task: 'transcribe', return_timestamps: false });
      self.postMessage({ type: 'result', id: message.id, text: result.text.trim() });
    }
  } catch (error) {
    self.postMessage({ type: 'error', id: message.id, message: error.message });
  }
};
