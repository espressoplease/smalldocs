---
title: Runnable HTML
file: runnable-html.md
---

# Runnable HTML

A SmallDoc can contain a working browser tool alongside its prose, charts, tables, and diagrams. Try the controls in these examples. Each one runs inside the page and can expand to fill the window without losing its state.

**1. Rotate a valuation surface**

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

**Try this prompt:** “Sdoc this financial model so I can rotate a 3D valuation surface, adjust revenue growth, operating margin, and discount rate, and see how valuation changes.”

---

**2. Run a queue through time**

Change the incoming work and service capacity, then run the clock. The same queue can grow, hold steady, or clear as the operating assumptions change.

~~~sdoc-app
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Live backlog simulator</title>
  <style>
    body { min-height: 460px; }
    .sim { display: grid; grid-template-columns: minmax(0, 1fr) 230px; gap: 18px; }
    .stage, .controls { border: 1px solid var(--sdoc-app-border-color); border-radius: var(--sdoc-app-radius); background: var(--sdoc-app-surface); }
    .stage { min-width: 0; padding: 16px; }
    .summary { display: flex; align-items: end; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
    .summary p { margin: 0; color: var(--sdoc-app-muted-color); }
    .summary output { display: block; color: var(--sdoc-app-heading-color); font-size: 2rem; font-weight: 700; line-height: 1; }
    .state { padding: 5px 9px; border-radius: 999px; background: var(--sdoc-app-background); font-size: .78rem; font-weight: 700; }
    canvas { display: block; width: 100%; height: 260px; border-radius: calc(var(--sdoc-app-radius) * .7); background: var(--sdoc-app-background); }
    .queue { display: flex; flex-wrap: wrap; align-content: start; gap: 5px; min-height: 42px; margin-top: 12px; }
    .job { width: 11px; height: 11px; border-radius: 3px; background: var(--sdoc-app-accent-color); }
    .more { align-self: center; color: var(--sdoc-app-muted-color); font-size: .78rem; }
    .controls { display: grid; align-content: start; gap: 16px; padding: 16px; }
    .controls h2 { margin: 0; font-size: 1.05rem; }
    label { display: grid; gap: 7px; font-weight: 600; }
    label span { display: flex; justify-content: space-between; gap: 10px; }
    input[type="range"] { width: 100%; }
    .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    button { cursor: pointer; font-weight: 700; }
    #toggle { color: var(--sdoc-app-background); background: var(--sdoc-app-accent-color); border-color: var(--sdoc-app-accent-color); }
    .clock { margin: 0; color: var(--sdoc-app-muted-color); font-size: .82rem; }
    @media (max-width: 700px) {
      body { min-height: 0; }
      .sim { grid-template-columns: 1fr; }
      canvas { height: 220px; }
      .controls { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .controls h2, .actions, .clock { grid-column: 1 / -1; }
    }
    @media (max-width: 440px) {
      .controls { grid-template-columns: 1fr; }
      .controls h2, .actions, .clock { grid-column: auto; }
    }
  </style>
</head>
<body>
  <div class="sim">
    <section class="stage" aria-label="Backlog over simulated time">
      <div class="summary">
        <p>Current backlog <output id="backlog">18 jobs</output></p>
        <span class="state" id="state">Growing</span>
      </div>
      <canvas id="history" aria-label="Line chart of backlog over time"></canvas>
      <div class="queue" id="queue" aria-label="Jobs waiting"></div>
    </section>
    <section class="controls" aria-label="Simulation controls">
      <h2>Operating assumptions</h2>
      <label>
        <span>Arrival rate <output id="arrivalOut">18/min</output></span>
        <input id="arrival" type="range" min="4" max="30" value="18">
      </label>
      <label>
        <span>Service capacity <output id="capacityOut">14/min</output></span>
        <input id="capacity" type="range" min="4" max="30" value="14">
      </label>
      <div class="actions">
        <button id="toggle" type="button">Run</button>
        <button id="reset" type="button">Reset</button>
      </div>
      <p class="clock">Simulated time: <output id="time">0 min</output></p>
    </section>
  </div>
  <script>
    const arrival = document.getElementById('arrival');
    const capacity = document.getElementById('capacity');
    const canvas = document.getElementById('history');
    const context = canvas.getContext('2d');
    const toggle = document.getElementById('toggle');
    let backlog = 18;
    let minute = 0;
    let running = false;
    let timer = null;
    let history = [{ minute: 0, backlog }];

    function status() {
      const gap = Number(arrival.value) - Number(capacity.value);
      return gap > 0 ? 'Growing' : gap < 0 ? 'Clearing' : 'Holding steady';
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
      const pad = { left: 40, right: 14, top: 16, bottom: 28 };
      const plotWidth = width - pad.left - pad.right;
      const plotHeight = height - pad.top - pad.bottom;
      const maxBacklog = Math.max(40, ...history.map(item => item.backlog));
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--sdoc-app-accent-color').trim() || '#2563eb';
      const border = getComputedStyle(document.documentElement).getPropertyValue('--sdoc-app-border-color').trim() || '#d6d3d1';
      const muted = getComputedStyle(document.documentElement).getPropertyValue('--sdoc-app-muted-color').trim() || '#78716c';
      context.strokeStyle = border;
      context.lineWidth = 1;
      [0, .5, 1].forEach(portion => {
        const y = pad.top + plotHeight * portion;
        context.beginPath();
        context.moveTo(pad.left, y);
        context.lineTo(width - pad.right, y);
        context.stroke();
      });
      context.fillStyle = muted;
      context.font = '11px ' + getComputedStyle(document.documentElement).getPropertyValue('--sdoc-app-font-family');
      context.fillText(Math.round(maxBacklog), 6, pad.top + 4);
      context.fillText('0', 24, height - pad.bottom + 4);
      context.fillText(minute + ' min', Math.max(pad.left, width - 54), height - 8);
      context.beginPath();
      history.forEach((item, index) => {
        const x = pad.left + (history.length === 1 ? 0 : index / Math.max(1, history.length - 1) * plotWidth);
        const y = pad.top + plotHeight - item.backlog / maxBacklog * plotHeight;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.strokeStyle = accent;
      context.lineWidth = 3;
      context.lineJoin = 'round';
      context.stroke();
    }

    function render() {
      document.getElementById('backlog').value = Math.round(backlog) + ' jobs';
      document.getElementById('arrivalOut').value = arrival.value + '/min';
      document.getElementById('capacityOut').value = capacity.value + '/min';
      document.getElementById('time').value = minute + ' min';
      document.getElementById('state').textContent = status();
      const queue = document.getElementById('queue');
      queue.replaceChildren();
      const visible = Math.min(40, Math.round(backlog));
      for (let index = 0; index < visible; index += 1) {
        const job = document.createElement('span');
        job.className = 'job';
        queue.appendChild(job);
      }
      if (backlog > visible) {
        const more = document.createElement('span');
        more.className = 'more';
        more.textContent = '+' + (Math.round(backlog) - visible) + ' more';
        queue.appendChild(more);
      }
      draw();
    }

    function step() {
      minute += 1;
      backlog = Math.max(0, backlog + Number(arrival.value) - Number(capacity.value));
      history.push({ minute, backlog });
      if (history.length > 50) history.shift();
      render();
    }

    toggle.addEventListener('click', () => {
      running = !running;
      toggle.textContent = running ? 'Pause' : 'Run';
      clearInterval(timer);
      if (running) timer = setInterval(step, 350);
    });
    document.getElementById('reset').addEventListener('click', () => {
      clearInterval(timer);
      running = false;
      toggle.textContent = 'Run';
      backlog = 18;
      minute = 0;
      history = [{ minute: 0, backlog }];
      render();
    });
    arrival.addEventListener('input', render);
    capacity.addEventListener('input', render);
    new ResizeObserver(draw).observe(canvas);
    render();
  </script>
</body>
</html>
~~~

**Try this prompt:** “Sdoc this operations analysis as a runnable queue simulation. Let me change arrival rate and service capacity, run or pause time, reset the model, and watch the backlog grow or clear.”

---

**3. Trace a system dependency**

Select a service to separate what it depends on from what depends on it. The highlighted route shows the longest dependency chain through the selection.

~~~sdoc-app
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Interactive dependency map</title>
  <style>
    body { min-height: 500px; }
    .explorer { display: grid; grid-template-columns: minmax(0, 1fr) 230px; gap: 18px; }
    .map, .details { border: 1px solid var(--sdoc-app-border-color); border-radius: var(--sdoc-app-radius); background: var(--sdoc-app-surface); }
    .map { min-width: 0; padding: 10px; overflow: hidden; }
    svg { display: block; width: 100%; min-height: 420px; }
    .edge { fill: none; stroke: var(--sdoc-app-border-color); stroke-width: 2; transition: opacity .2s, stroke .2s, stroke-width .2s; }
    .edge.muted { opacity: .13; }
    .edge.upstream { stroke: #0ea5e9; }
    .edge.downstream { stroke: #f59e0b; }
    .edge.critical { stroke: #8b5cf6; stroke-width: 5; }
    .node { cursor: pointer; outline: none; }
    .node rect { fill: var(--sdoc-app-background); stroke: var(--sdoc-app-border-color); stroke-width: 2; transition: opacity .2s, fill .2s, stroke .2s, stroke-width .2s; }
    .node text { fill: var(--sdoc-app-color); font: 600 14px var(--sdoc-app-font-family); pointer-events: none; }
    .node.muted { opacity: .25; }
    .node.upstream rect { fill: color-mix(in srgb, #0ea5e9 18%, var(--sdoc-app-background)); stroke: #0ea5e9; }
    .node.downstream rect { fill: color-mix(in srgb, #f59e0b 18%, var(--sdoc-app-background)); stroke: #f59e0b; }
    .node.critical rect { stroke: #8b5cf6; stroke-width: 4; }
    .node.selected rect { fill: color-mix(in srgb, var(--sdoc-app-accent-color) 20%, var(--sdoc-app-background)); stroke: var(--sdoc-app-accent-color); stroke-width: 4; }
    .node:focus-visible rect { stroke-dasharray: 5 3; }
    .details { display: grid; align-content: start; gap: 14px; padding: 16px; }
    .details h2 { margin: 0; font-size: 1.1rem; }
    .details h3 { margin: 0 0 5px; font-size: .84rem; }
    .details p { margin: 0; color: var(--sdoc-app-muted-color); font-size: .85rem; }
    .legend { display: grid; gap: 6px; }
    .legend span { display: flex; align-items: center; gap: 8px; font-size: .78rem; }
    .swatch { width: 18px; height: 4px; border-radius: 3px; }
    .up-key { background: #0ea5e9; }
    .down-key { background: #f59e0b; }
    .critical-key { background: #8b5cf6; }
    @media (max-width: 700px) {
      body { min-height: 0; }
      .explorer { grid-template-columns: 1fr; }
      svg { min-height: 330px; }
      .details { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .details h2, .legend { grid-column: 1 / -1; }
    }
    @media (max-width: 440px) {
      .details { grid-template-columns: 1fr; }
      .details h2, .legend { grid-column: auto; }
    }
  </style>
</head>
<body>
  <div class="explorer">
    <div class="map">
      <svg viewBox="0 0 780 460" role="img" aria-label="Selectable service dependency graph">
        <g id="edges"></g>
        <g id="nodes"></g>
      </svg>
    </div>
    <aside class="details" aria-live="polite">
      <h2 id="selection">Orders</h2>
      <section><h3>Upstream dependencies</h3><p id="upstream"></p></section>
      <section><h3>Downstream effects</h3><p id="downstream"></p></section>
      <section><h3>Longest dependency chain</h3><p id="critical"></p></section>
      <div class="legend">
        <span><i class="swatch up-key"></i>Upstream</span>
        <span><i class="swatch down-key"></i>Downstream</span>
        <span><i class="swatch critical-key"></i>Longest chain</span>
      </div>
    </aside>
  </div>
  <script>
    const services = {
      users: { label: 'Users DB', x: 20, y: 40, w: 125 },
      ordersdb: { label: 'Orders DB', x: 20, y: 190, w: 125 },
      queue: { label: 'Event queue', x: 20, y: 340, w: 125 },
      auth: { label: 'Auth', x: 245, y: 40, w: 125 },
      billing: { label: 'Billing', x: 245, y: 165, w: 125 },
      orders: { label: 'Orders', x: 245, y: 275, w: 125 },
      notify: { label: 'Notifications', x: 245, y: 385, w: 125 },
      gateway: { label: 'API gateway', x: 475, y: 165, w: 135 },
      web: { label: 'Web app', x: 650, y: 165, w: 110 }
    };
    const dependencies = {
      users: [], ordersdb: [], queue: [],
      auth: ['users'], billing: ['ordersdb'],
      orders: ['ordersdb', 'billing', 'queue'], notify: ['queue'],
      gateway: ['auth', 'orders'], web: ['gateway']
    };
    const consumers = Object.fromEntries(Object.keys(services).map(id => [id, []]));
    Object.entries(dependencies).forEach(([consumer, items]) => {
      items.forEach(dependency => consumers[dependency].push(consumer));
    });
    const svg = document.querySelector('svg');
    const edgeLayer = document.getElementById('edges');
    const nodeLayer = document.getElementById('nodes');
    const edgeElements = new Map();
    const nodeElements = new Map();

    function center(id, side) {
      const item = services[id];
      return { x: item.x + (side === 'right' ? item.w : 0), y: item.y + 25 };
    }

    Object.entries(dependencies).forEach(([consumer, items]) => {
      items.forEach(dependency => {
        const from = center(dependency, 'right');
        const to = center(consumer, 'left');
        const middle = (from.x + to.x) / 2;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', `M ${from.x} ${from.y} C ${middle} ${from.y}, ${middle} ${to.y}, ${to.x} ${to.y}`);
        path.setAttribute('class', 'edge');
        edgeLayer.appendChild(path);
        edgeElements.set(dependency + '>' + consumer, path);
      });
    });

    Object.entries(services).forEach(([id, item]) => {
      const node = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      node.setAttribute('class', 'node');
      node.setAttribute('tabindex', '0');
      node.setAttribute('role', 'button');
      node.setAttribute('aria-label', 'Select ' + item.label);
      node.dataset.id = id;
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', item.x);
      rect.setAttribute('y', item.y);
      rect.setAttribute('width', item.w);
      rect.setAttribute('height', 50);
      rect.setAttribute('rx', 10);
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', item.x + item.w / 2);
      text.setAttribute('y', item.y + 30);
      text.setAttribute('text-anchor', 'middle');
      text.textContent = item.label;
      node.append(rect, text);
      node.addEventListener('click', () => select(id));
      node.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          select(id);
        }
      });
      nodeLayer.appendChild(node);
      nodeElements.set(id, node);
    });

    function collect(start, links) {
      const found = new Set();
      function visit(id) {
        (links[id] || []).forEach(next => {
          if (found.has(next)) return;
          found.add(next);
          visit(next);
        });
      }
      visit(start);
      return found;
    }

    function longest(start, links, seen = new Set()) {
      if (seen.has(start)) return [start];
      const nextSeen = new Set(seen);
      nextSeen.add(start);
      let best = [];
      (links[start] || []).forEach(next => {
        const candidate = longest(next, links, nextSeen);
        if (candidate.length > best.length) best = candidate;
      });
      return [start, ...best];
    }

    function labels(ids) {
      return ids.length ? ids.map(id => services[id].label).join(', ') : 'None';
    }

    function select(id) {
      const upstream = collect(id, dependencies);
      const downstream = collect(id, consumers);
      const upPath = longest(id, dependencies);
      const downPath = longest(id, consumers);
      const criticalNodes = new Set([...upPath, ...downPath]);
      const criticalEdges = new Set();
      for (let index = 0; index < upPath.length - 1; index += 1) {
        criticalEdges.add(upPath[index + 1] + '>' + upPath[index]);
      }
      for (let index = 0; index < downPath.length - 1; index += 1) {
        criticalEdges.add(downPath[index] + '>' + downPath[index + 1]);
      }
      nodeElements.forEach((node, nodeId) => {
        node.setAttribute('class', 'node' +
          (nodeId === id ? ' selected' : '') +
          (upstream.has(nodeId) ? ' upstream' : '') +
          (downstream.has(nodeId) ? ' downstream' : '') +
          (criticalNodes.has(nodeId) ? ' critical' : '') +
          (nodeId !== id && !upstream.has(nodeId) && !downstream.has(nodeId) ? ' muted' : ''));
      });
      edgeElements.forEach((edge, key) => {
        const [dependency, consumer] = key.split('>');
        let kind = ' muted';
        if (upstream.has(dependency) && (upstream.has(consumer) || consumer === id)) kind = ' upstream';
        if (downstream.has(consumer) && (downstream.has(dependency) || dependency === id)) kind = ' downstream';
        if (criticalEdges.has(key)) kind = ' critical';
        edge.setAttribute('class', 'edge' + kind);
      });
      document.getElementById('selection').textContent = services[id].label;
      document.getElementById('upstream').textContent = labels([...upstream]);
      document.getElementById('downstream').textContent = labels([...downstream]);
      const path = [...upPath].reverse().concat(downPath.slice(1));
      document.getElementById('critical').textContent = path.map(item => services[item].label).join(' → ');
    }

    select('orders');
  </script>
</body>
</html>
~~~

**Try this prompt:** “Sdoc this system map as a runnable dependency map. Let me select any service to highlight its upstream dependencies, downstream effects, and longest dependency chain through that service.”

---

Runnable components stay inside a sandboxed frame. They cannot read the SmallDocs page, account controls, cookies, or storage. Network requests can still leave the browser.

To make your own, describe what should move, what you want to change, and what the result should show. Developers embedding SmallDocs can use the [Renderer SDK](/developers); the [runnable component reference](/developers/authoring/apps) covers the HTML format.
