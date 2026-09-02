---
title: Runnable HTML components
file: runnable-html.md
---

# Runnable HTML components

A SmallDoc can contain a self-contained browser tool alongside its prose, charts, tables, and diagrams. The component runs inside the document and can expand to fill the window without losing its state.

Use runnable HTML only when interacting with the result helps the reader understand something that prose, a diagram, a chart, or computed cells cannot express as clearly. Examples include manipulating linked inputs, running a simulation, rotating or zooming a spatial model, and exploring linked states. If a static form communicates the result as clearly, use it.

**A three-input financial model**

Revenue growth and operating margin form the surface, while the discount rate changes its shape. Drag to rotate, scroll to zoom, and adjust the inputs to see how the assumptions affect the result.

~~~sdoc-app
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Interactive valuation surface</title>
  <style>
    body { min-height: 520px; }
    .model { display: grid; grid-template-columns: minmax(0, 1fr) 220px; gap: 18px; }
    .stage { position: relative; min-height: 430px; border: 1px solid var(--sdoc-app-border-color); border-radius: var(--sdoc-app-radius); overflow: hidden; background: color-mix(in srgb, var(--sdoc-app-surface) 82%, var(--sdoc-app-accent-color) 18%); }
    canvas { display: block; width: 100%; height: 430px; cursor: grab; touch-action: none; }
    canvas:active { cursor: grabbing; }
    .hint { position: absolute; left: 12px; bottom: 10px; margin: 0; color: var(--sdoc-app-muted-color); font-size: .82rem; pointer-events: none; }
    .controls { display: grid; align-content: start; gap: 16px; }
    .controls h2 { margin: 0; font-size: 1.05rem; }
    label { display: grid; gap: 7px; font-weight: 600; }
    label span { display: flex; justify-content: space-between; gap: 10px; }
    input[type="range"] { width: 100%; }
    .result { padding: 14px; border: 1px solid var(--sdoc-app-border-color); border-radius: var(--sdoc-app-radius); background: var(--sdoc-app-surface); }
    .result small { display: block; color: var(--sdoc-app-muted-color); }
    .result output { display: block; margin-top: 3px; color: var(--sdoc-app-heading-color); font-size: 1.45rem; font-weight: 700; }
    @media (max-width: 700px) {
      body { min-height: 0; }
      .model { grid-template-columns: 1fr; }
      .stage, canvas { min-height: 340px; height: 340px; }
      .controls { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .controls h2, .result { grid-column: 1 / -1; }
    }
    @media (max-width: 440px) {
      .controls { grid-template-columns: 1fr; }
      .controls h2, .result { grid-column: auto; }
    }
  </style>
</head>
<body>
  <div class="model">
    <div class="stage">
      <canvas id="surface" aria-label="Rotatable valuation surface showing revenue growth, operating margin, and model value"></canvas>
      <p class="hint">Drag to rotate · Scroll to zoom</p>
    </div>
    <section class="controls" aria-label="Model inputs">
      <h2>Selected scenario</h2>
      <label>
        <span>Revenue growth <output id="growthOut">9%</output></span>
        <input id="growth" type="range" min="0" max="20" step="1" value="9">
      </label>
      <label>
        <span>Operating margin <output id="marginOut">21%</output></span>
        <input id="margin" type="range" min="5" max="35" step="1" value="21">
      </label>
      <label>
        <span>Discount rate <output id="discountOut">10%</output></span>
        <input id="discount" type="range" min="5" max="16" step="0.5" value="10">
      </label>
      <div class="result">
        <small>Five-year model value</small>
        <output id="valueOut">£0m</output>
      </div>
    </section>
  </div>
  <script>
    const canvas = document.getElementById('surface');
    const context = canvas.getContext('2d');
    const inputs = {
      growth: document.getElementById('growth'),
      margin: document.getElementById('margin'),
      discount: document.getElementById('discount')
    };
    const outputs = {
      growth: document.getElementById('growthOut'),
      margin: document.getElementById('marginOut'),
      discount: document.getElementById('discountOut'),
      value: document.getElementById('valueOut')
    };
    let yaw = -0.72;
    let pitch = 0.62;
    let zoom = 1;
    let drag = null;

    function valuation(growth, margin, discount) {
      let revenue = 100;
      let present = 0;
      for (let year = 1; year <= 5; year += 1) {
        revenue *= 1 + growth / 100;
        const cash = revenue * margin / 100 * 0.78;
        present += cash / Math.pow(1 + discount / 100, year);
      }
      const terminal = revenue * margin / 100 * 0.78 * 10;
      return present + terminal / Math.pow(1 + discount / 100, 5);
    }

    function project(x, y, z, width, height) {
      const cosY = Math.cos(yaw);
      const sinY = Math.sin(yaw);
      const cosP = Math.cos(pitch);
      const sinP = Math.sin(pitch);
      const rx = x * cosY - y * sinY;
      const ry = x * sinY + y * cosY;
      const rz = z;
      const py = ry * cosP - rz * sinP;
      const depth = ry * sinP + rz * cosP;
      const scale = Math.min(width, height) * 0.34 * zoom;
      return { x: width * 0.48 + rx * scale, y: height * 0.58 + py * scale, depth };
    }

    function point(growth, margin, discount, width, height) {
      const value = valuation(growth, margin, discount);
      const x = growth / 10 - 1;
      const y = (margin - 20) / 15;
      const z = -(value - 120) / 300;
      return { ...project(x, y, z, width, height), value };
    }

    function draw() {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);

      const discount = Number(inputs.discount.value);
      const steps = 12;
      const cells = [];
      for (let row = 0; row < steps; row += 1) {
        for (let column = 0; column < steps; column += 1) {
          const g0 = column / steps * 20;
          const g1 = (column + 1) / steps * 20;
          const m0 = 5 + row / steps * 30;
          const m1 = 5 + (row + 1) / steps * 30;
          const corners = [
            point(g0, m0, discount, width, height),
            point(g1, m0, discount, width, height),
            point(g1, m1, discount, width, height),
            point(g0, m1, discount, width, height)
          ];
          cells.push({ corners, depth: corners.reduce((sum, item) => sum + item.depth, 0) / 4 });
        }
      }
      cells.sort((a, b) => a.depth - b.depth);
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--sdoc-app-accent-color').trim() || '#6d5dfc';
      cells.forEach(({ corners }) => {
        const average = corners.reduce((sum, item) => sum + item.value, 0) / 4;
        const lightness = Math.max(34, Math.min(72, 34 + (average - 100) / 8));
        context.beginPath();
        context.moveTo(corners[0].x, corners[0].y);
        corners.slice(1).forEach(item => context.lineTo(item.x, item.y));
        context.closePath();
        context.globalAlpha = 0.78;
        context.fillStyle = `hsl(250 72% ${lightness}% / 0.78)`;
        context.fill();
        context.globalAlpha = 0.28;
        context.strokeStyle = accent;
        context.stroke();
      });
      context.globalAlpha = 1;

      const selected = point(Number(inputs.growth.value), Number(inputs.margin.value), discount, width, height);
      context.beginPath();
      context.arc(selected.x, selected.y, 6, 0, Math.PI * 2);
      context.fillStyle = accent;
      context.fill();
      context.lineWidth = 3;
      context.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--sdoc-app-background').trim() || '#fff';
      context.stroke();

      outputs.growth.value = inputs.growth.value + '%';
      outputs.margin.value = inputs.margin.value + '%';
      outputs.discount.value = Number(inputs.discount.value).toFixed(1).replace('.0', '') + '%';
      outputs.value.value = '£' + Math.round(selected.value) + 'm';
    }

    Object.values(inputs).forEach(input => input.addEventListener('input', draw));
    canvas.addEventListener('pointerdown', event => {
      drag = { x: event.clientX, y: event.clientY, yaw, pitch };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', event => {
      if (!drag) return;
      yaw = drag.yaw + (event.clientX - drag.x) * 0.008;
      pitch = Math.max(0.15, Math.min(1.25, drag.pitch + (event.clientY - drag.y) * 0.006));
      draw();
    });
    canvas.addEventListener('pointerup', () => { drag = null; });
    canvas.addEventListener('pointercancel', () => { drag = null; });
    canvas.addEventListener('wheel', event => {
      event.preventDefault();
      zoom = Math.max(0.65, Math.min(1.5, zoom * (event.deltaY > 0 ? 0.92 : 1.08)));
      draw();
    }, { passive: false });
    new ResizeObserver(draw).observe(canvas);
    draw();
  </script>
</body>
</html>
~~~

Changing the inputs and rotating the model reveals how the assumptions affect the output. A static chart captures one view; this component lets the reader inspect the relationship from different points.

## How an agent should decide

Ask whether the result loses important meaning when it becomes static.

- Use prose or a table when the reader needs facts or exact values.
- Use a Mermaid diagram when the reader needs relationships or sequence.
- Use a chart when a fixed quantitative view answers the question.
- Use computed cells when the reader needs to inspect or edit numbers.
- Use runnable HTML when the reader must manipulate, simulate, rotate, zoom, or move through linked states to understand the result.

If ordinary document features can express the result equally well, use them. Runnable HTML carries more code, more testing, and an explicit execution boundary.

## Ask for one

Describe the decision or relationship you need to understand, rather than asking for HTML for its own sake:

> Sdoc the financial model. I need to understand how revenue growth, operating margin, and discount rate interact. Build a runnable component if manipulating the three assumptions communicates that relationship better than static charts or cells.

Agents with the SmallDocs skill can run `sdoc apps` for the complete authoring contract. Developers embedding agent-written SmallDocs can use the [Renderer SDK](/developers) and enable its `runnableHtml` option. The [runnable HTML authoring reference](/developers/authoring/apps) covers the fence format, inherited design tokens, responsive behavior, and sandbox boundary.

## Execution boundary

Runnable components execute only inside a `sdoc-app` fence. They run in a sandboxed frame that cannot read the SmallDocs page, its account controls, cookies, or storage. Network requests can still leave the browser and remain subject to the destination's CORS rules and any Content Security Policy declared by the component.

An ordinary `html` fence remains readable source code.
