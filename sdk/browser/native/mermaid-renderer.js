const token = new URL(location.href).searchParams.get('token') || '';
const mermaidPromise = Promise.all([
  Promise.resolve(window.mermaid),
  document.fonts && document.fonts.load
    ? Promise.all([
      document.fonts.load('400 16px Inter'),
      document.fonts.load('500 16px Inter'),
      document.fonts.load('600 16px Inter'),
    ])
    : Promise.resolve(),
]).then((values) => {
  if (!values[0]) throw new Error('Mermaid did not load.');
  return values[0];
});

function send(message) {
  window.parent.postMessage(Object.assign({ token }, message), '*');
}

window.addEventListener('message', async (event) => {
  const request = event.data;
  if (event.source !== window.parent || !request || request.token !== token || request.type !== 'render') return;
  try {
    const mermaid = await mermaidPromise;
    const config = Object.assign({}, request.config || {}, {
      startOnLoad: false,
      securityLevel: 'strict',
    });
    mermaid.initialize(config);
    const output = await mermaid.render(request.diagramId, request.source);
    send({ type: 'result', requestId: request.requestId, svg: output.svg });
  } catch (error) {
    send({ type: 'result', requestId: request.requestId, error: error && error.message ? error.message : String(error) });
  }
});

mermaidPromise.then(
  () => send({ type: 'ready' }),
  (error) => send({ type: 'failed', error: error && error.message ? error.message : String(error) })
);
