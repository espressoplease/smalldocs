const MERMAID_JS = 'https://cdn.jsdelivr.net/npm/mermaid@11.16.1/dist/mermaid.esm.min.mjs';
const token = new URL(location.href).searchParams.get('token') || '';
const mermaidPromise = import(MERMAID_JS).then((module) => module.default || module);

function send(message) {
  window.parent.postMessage(Object.assign({ token }, message), '*');
}

window.addEventListener('message', async (event) => {
  const request = event.data;
  if (event.source !== window.parent || !request || request.token !== token || request.type !== 'render') return;
  try {
    const mermaid = await mermaidPromise;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      htmlLabels: false,
      theme: 'base',
      themeVariables: request.themeVariables || {},
    });
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
