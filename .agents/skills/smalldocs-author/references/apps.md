# Runnable HTML

Use a `sdoc-app` fence for a self-contained browser tool whose interaction is part of the result. The block contains one complete HTML document and runs inline in a sandboxed frame.

## Basic form

````md
~~~sdoc-app
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Scenario explorer</title>
  <style>
    body { font: 16px system-ui; margin: 0; padding: 24px; }
  </style>
</head>
<body>
  <label>Value <input id="value" type="range" min="0" max="100" value="50"></label>
  <output id="result">50</output>
  <script>
    value.addEventListener('input', () => { result.value = value.value; });
  </script>
</body>
</html>
~~~
````

Use `<title>` to provide the component name shown by SmallDocs. Prefer one complete document with its CSS, JavaScript, and data together. Browser-native APIs, canvas, SVG, forms, and inline scripts are available. Use external resources only when the component is intentionally network-dependent.

## Reader behavior

The component starts inline and reports its own document height. SmallDocs keeps the inline view between 320px and 760px. The expand control opens the same running frame fullscreen, so current inputs and JavaScript state remain in place. A document with several `sdoc-app` blocks gains Previous and Next controls in fullscreen.

An ordinary `html` fence is always a source listing. Use `sdoc-app` only when the HTML should execute.

## Browser boundary

The component frame can run scripts and use forms, modals, downloads, and popups. It cannot read or modify the SmallDocs page, host application DOM, account controls, cookies, or storage. Network requests still leave the browser and remain subject to Content Security Policy and the destination's CORS rules.

Keep the result usable without access to the parent document. Do not depend on parent DOM selectors, SmallDocs globals, same-origin storage, or top-level navigation.

## Authoring check

Run `sdoc apps` for the current runtime reference. Open the finished Markdown with `sdoc file.md`, exercise every control inline, expand it, confirm state survives the transition, and check Previous and Next when the document contains more than one component.
