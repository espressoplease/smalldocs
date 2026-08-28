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
</head>
<body>
  <label>Value <input id="value" type="range" min="0" max="100" value="50"></label>
  <output id="result">50</output>
  <script>
    const slider = document.getElementById('value');
    const result = document.getElementById('result');
    slider.addEventListener('input', () => { result.value = slider.value; });
  </script>
</body>
</html>
~~~
````

Use `<title>` to provide the component name shown by SmallDocs. Prefer one complete document with its CSS, JavaScript, and data together. Browser-native APIs, canvas, SVG, forms, and inline scripts are available. Use external resources only when the component is intentionally network-dependent.

## Inherited design

Start with semantic HTML and add CSS for the component's layout. SmallDocs supplies a responsive base treatment using the surrounding document's resolved styles:

- body and heading font families, base font size, and line height
- text, heading, muted, accent, background, surface, and border colours
- heading sizes and weights, paragraph spacing, and corner radius
- zero body margin, responsive body padding, border-box sizing, and fluid media
- a restrained base treatment for links, tables, code, buttons, and form controls

The parent design is available through these custom properties:

```css
--sdoc-app-background
--sdoc-app-surface
--sdoc-app-color
--sdoc-app-heading-color
--sdoc-app-muted-color
--sdoc-app-accent-color
--sdoc-app-border-color
--sdoc-app-font-family
--sdoc-app-heading-font-family
--sdoc-app-code-font-family
--sdoc-app-font-size
--sdoc-app-line-height
--sdoc-app-heading-scale
--sdoc-app-h1-size
--sdoc-app-h2-size
--sdoc-app-h3-size
--sdoc-app-h1-weight
--sdoc-app-h2-weight
--sdoc-app-h3-weight
--sdoc-app-radius
--sdoc-app-block-spacing
--sdoc-app-padding
--sdoc-app-color-scheme
```

SmallDocs puts its defaults in a low-priority CSS layer. Ordinary CSS in the component overrides them. Set a custom property when the component should keep the surrounding design but change one token, or write normal element and class rules for a larger visual departure:

```css
:root {
  --sdoc-app-background: #101827;
  --sdoc-app-color: #f8fafc;
  --sdoc-app-accent-color: #7dd3fc;
}

body { padding: 12px; }
.workspace { min-height: 420px; }
```

The inherited values follow document style and theme changes. Do not copy a generic body reset, font stack, background, or control theme into every component when the inherited design already fits.

The bundled Inter faces load inside the component. System fonts work through the normal font stack. If the surrounding document selects another webfont and its exact face matters, load it inside the component with a `<link>` or `@font-face` rule.

## Size and responsive layout

The component owns its inline height. SmallDocs measures the complete document and follows that height without imposing a minimum or maximum. The frame width follows the SmallDocs reading column. Fullscreen uses the available browser viewport.

- Include `<meta name="viewport" content="width=device-width, initial-scale=1">`.
- Let normal document flow determine height when the content can grow.
- Set `min-height`, `height`, or `aspect-ratio` in the component's own CSS when a canvas, simulation, or dashboard needs a deliberate working area.
- Avoid a fixed page width. Use fluid widths, grid or flex wrapping, media or container queries, and controls that remain usable at narrow widths.
- Size canvas and other measured graphics from their rendered container. `ResizeObserver` and the normal window `resize` event are available.
- Check the result inline and fullscreen at both narrow and wide widths. Do not assume either viewport has a particular size.

A concise inline height keeps the surrounding document easy to navigate. A dense tool can take more space or rely on the expand control. These are authoring choices rather than renderer limits.

## Reader behavior

The component starts inline and reports its document height whenever layout changes. The expand control opens the same running frame fullscreen, so current inputs and JavaScript state remain in place. A document with several `sdoc-app` blocks gains Previous and Next controls in fullscreen.

An ordinary `html` fence is always a source listing. Use `sdoc-app` only when the HTML should execute.

## Browser boundary

The component frame can run scripts and use forms, modals, downloads, and popups. It cannot read or modify the SmallDocs page, host application DOM, account controls, cookies, or storage. Network requests still leave the browser and remain subject to Content Security Policy and the destination's CORS rules.

Keep the result usable without access to the parent document. Do not depend on parent DOM selectors, SmallDocs globals, same-origin storage, or top-level navigation.

## Authoring check

Run `sdoc apps` for the current runtime reference. Open the finished Markdown with `sdoc file.md`, exercise every control inline, check narrow and wide layouts, expand it, confirm state survives the transition, and check Previous and Next when the document contains more than one component.
