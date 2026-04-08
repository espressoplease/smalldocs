/* ═══════════════════════════════════════════════════
   SDocs Charts — render ```chart code blocks as Chart.js charts
   Lazy-loads Chart.js from CDN on first use.

   Supported types:
     pie, doughnut, bar, horizontal_bar, stacked_bar, stacked_horizontal_bar,
     line, area, stacked_area, radar, polarArea, scatter, bubble, mixed

   Options:
     title, subtitle, labels, values, datasets, colors,
     xAxis, yAxis, y2Axis, legend, aspectRatio,
     format (currency/percent/number), stacked,
     min, max, stepSize, beginAtZero,
     annotations (horizontal/vertical reference lines)
═══════════════════════════════════════════════════ */
(function () {
  var S = window.SDocs;
  var chartJsLoaded = false;
  var chartJsLoading = false;
  var pendingCallbacks = [];
  var CDN_CHART = 'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js';
  var CDN_LABELS = 'https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2/dist/chartjs-plugin-datalabels.min.js';
  var activeCharts = [];

  // ── Fallback palette (used when no accent is set) ──
  var DEFAULT_PALETTE = [
    '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
    '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
    '#06b6d4', '#d946ef', '#0ea5e9', '#a3e635', '#fb923c',
    '#e11d48', '#2dd4bf', '#a78bfa', '#fbbf24', '#34d399'
  ];

  // ── HSL helpers ──
  function hexToHsl(hex) {
    var r = parseInt(hex.slice(1, 3), 16) / 255;
    var g = parseInt(hex.slice(3, 5), 16) / 255;
    var b = parseInt(hex.slice(5, 7), 16) / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h, s, l = (max + min) / 2;
    if (max === min) { h = s = 0; }
    else {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (max === g) h = ((b - r) / d + 2) / 6;
      else h = ((r - g) / d + 4) / 6;
    }
    return [h * 360, s * 100, l * 100];
  }

  function hslToHex(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s = Math.max(0, Math.min(100, s)) / 100;
    l = Math.max(0, Math.min(100, l)) / 100;
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var x = c * (1 - Math.abs((h / 60) % 2 - 1));
    var m = l - c / 2;
    var r, g, b;
    if (h < 60)       { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else              { r = c; g = 0; b = x; }
    var toHex = function (v) { var h = Math.round((v + m) * 255).toString(16); return h.length < 2 ? '0' + h : h; };
    return '#' + toHex(r) + toHex(g) + toHex(b);
  }

  // ── Palette generation ──
  // Modes: complementary, monochrome, analogous, triadic, warm, cool, pastel, earth
  function generatePalette(accent, mode, count) {
    var hsl = hexToHsl(accent);
    var h = hsl[0], s = hsl[1], l = hsl[2];
    var colors = [];
    var i;

    switch (mode) {
      case 'monochrome':
      case 'mono':
        // Same hue, spread lightness from dark to light
        for (i = 0; i < count; i++) {
          var li = 25 + (50 * i / Math.max(count - 1, 1)); // 25% to 75%
          colors.push(hslToHex(h, s, li));
        }
        break;

      case 'analogous':
        // ±40° spread around the accent hue
        var spread = 40;
        for (i = 0; i < count; i++) {
          var offset = -spread + (2 * spread * i / Math.max(count - 1, 1));
          colors.push(hslToHex(h + offset, s, l));
        }
        break;

      case 'triadic':
        // Three base hues 120° apart, then vary lightness
        for (i = 0; i < count; i++) {
          var baseH = h + (i % 3) * 120;
          var li2 = l + (Math.floor(i / 3) * 10 - 10);
          colors.push(hslToHex(baseH, s, li2));
        }
        break;

      case 'warm':
        for (i = 0; i < count; i++) {
          colors.push(hslToHex(i * (60 / count), 70 + (i % 3) * 10, 50 + (i % 2) * 10));
        }
        break;

      case 'cool':
        for (i = 0; i < count; i++) {
          colors.push(hslToHex(180 + i * (80 / count), 60 + (i % 3) * 10, 45 + (i % 2) * 10));
        }
        break;

      case 'pastel':
        for (i = 0; i < count; i++) {
          colors.push(hslToHex(h + i * (360 / count), 55, 75));
        }
        break;

      case 'earth':
        var earthHues = [30, 45, 20, 60, 15, 35, 50, 10, 40, 25];
        for (i = 0; i < count; i++) {
          colors.push(hslToHex(earthHues[i % earthHues.length], 45 + (i % 3) * 10, 40 + (i % 4) * 8));
        }
        break;

      case 'complementary':
      default:
        // Spread hues evenly around the wheel, starting from accent
        for (i = 0; i < count; i++) {
          colors.push(hslToHex(h + i * (360 / count), s, l));
        }
        break;
    }

    return colors;
  }

  // ── Get active palette (reads CSS vars or per-chart overrides) ──
  function getActivePalette(data, count) {
    // Per-chart colors override everything
    if (data.colors) return data.colors;

    // Per-chart accent + mode
    var accent = data.accent || null;
    var mode = data.palette || null;

    // Fall back to front matter chart styles (persisted on S.chartStyles)
    if (!accent && S.chartStyles) {
      accent = S.chartStyles.accent || null;
      if (!mode) mode = S.chartStyles.palette || null;
    }

    // Fall back to CSS vars from style panel
    if (!accent) {
      var rendered = document.getElementById('rendered');
      if (rendered) {
        var cs = getComputedStyle(rendered);
        accent = cs.getPropertyValue('--md-chart-accent').trim() || null;
        if (!mode) mode = cs.getPropertyValue('--md-chart-palette').trim() || null;
      }
    }

    // No accent set — use the default static palette
    if (!accent) return DEFAULT_PALETTE.slice(0, Math.max(count, 1));

    return generatePalette(accent, mode || 'monochrome', count);
  }

  function paletteColor(data, i, count) {
    var pal = getActivePalette(data, count || 10);
    return pal[i % pal.length];
  }

  function loadScript(url, cb) {
    var s = document.createElement('script');
    s.src = url;
    s.onload = cb;
    s.onerror = function () { console.error('SDocs: failed to load ' + url); };
    document.head.appendChild(s);
  }

  function ensureChartJs(cb) {
    if (chartJsLoaded) return cb();
    pendingCallbacks.push(cb);
    if (chartJsLoading) return;
    chartJsLoading = true;
    loadScript(CDN_CHART, function () {
      loadScript(CDN_LABELS, function () {
        Chart.register(ChartDataLabels);
        chartJsLoaded = true;
        chartJsLoading = false;
        pendingCallbacks.forEach(function (fn) { fn(); });
        pendingCallbacks = [];
      });
    });
  }

  // ── Theme ──
  function isDark() {
    return document.documentElement.dataset.theme === 'dark';
  }

  function getDocFont() {
    var rendered = document.getElementById('rendered');
    if (!rendered) return '';
    return getComputedStyle(rendered).getPropertyValue('--md-font-family').trim() || '';
  }

  function theme() {
    var dark = isDark();
    return {
      font: getDocFont(),
      text: dark ? '#A8A29E' : '#78716c',
      grid: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
      title: dark ? '#E7E5E2' : '#1C1917',
      tooltipBg: dark ? '#292524' : '#fff',
      tooltipBorder: dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
      annotationColor: dark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)',
      annotationLabel: dark ? '#E7E5E2' : '#1C1917'
    };
  }

  // ── Parse ──
  function parseChartData(text) {
    try { return JSON.parse(text); } catch (e) { return null; }
  }

  // ── Number formatting ──
  function makeTickCallback(fmt, prefix, suffix) {
    if (!fmt && !prefix && !suffix) return null;
    return function (value) {
      var v = value;
      if (fmt === 'currency' || fmt === 'dollar' || fmt === 'usd')
        return (prefix || '$') + v.toLocaleString() + (suffix || '');
      if (fmt === 'euro') return (prefix || '€') + v.toLocaleString() + (suffix || '');
      if (fmt === 'pound') return (prefix || '£') + v.toLocaleString() + (suffix || '');
      if (fmt === 'percent' || fmt === 'percentage')
        return (prefix || '') + v + (suffix || '%');
      if (fmt === 'number' || fmt === 'comma')
        return (prefix || '') + v.toLocaleString() + (suffix || '');
      return (prefix || '') + v + (suffix || '');
    };
  }

  // ── Normalize type aliases ──
  function normalizeType(raw) {
    var t = (raw || 'bar').toLowerCase().replace(/[\s-]/g, '_');
    var map = {
      pie_chart: 'pie', piechart: 'pie',
      bar_chart: 'bar', barchart: 'bar',
      line_chart: 'line', linechart: 'line',
      donut: 'doughnut', donut_chart: 'doughnut', doughnut_chart: 'doughnut',
      horizontal_bar: 'horizontalBar', hbar: 'horizontalBar',
      horizontal_bar_chart: 'horizontalBar', hbarchart: 'horizontalBar',
      stacked_bar: 'stackedBar', stackedbar: 'stackedBar',
      stacked_bar_chart: 'stackedBar', stackedbarchart: 'stackedBar',
      stacked_horizontal_bar: 'stackedHBar', stacked_hbar: 'stackedHBar',
      area: 'area', area_chart: 'area', areachart: 'area',
      stacked_area: 'stackedArea', stackedarea: 'stackedArea',
      stacked_line: 'stackedArea',
      radar_chart: 'radar', radarchart: 'radar', spider: 'radar',
      polararea: 'polarArea', polar_area: 'polarArea', polar: 'polarArea', polar_area_chart: 'polarArea',
      scatter_chart: 'scatter', scatterchart: 'scatter', scatter_plot: 'scatter',
      bubble_chart: 'bubble', bubblechart: 'bubble',
      doughnut: 'doughnut',
      combo: 'mixed', mixed_chart: 'mixed', combination: 'mixed'
    };
    return map[t] || t;
  }

  // ── Build datasets ──
  function buildDatasets(data, chartType) {
    var isRadial = chartType === 'pie' || chartType === 'doughnut' || chartType === 'polarArea';
    var isLine = chartType === 'line' || chartType === 'area' || chartType === 'stackedArea';
    var isBubble = chartType === 'bubble';
    var isScatter = chartType === 'scatter';
    var isFill = chartType === 'area' || chartType === 'stackedArea';
    var isMixed = chartType === 'mixed';

    if (isRadial) {
      var values = data.values || (data.datasets && data.datasets[0] && data.datasets[0].values) || [];
      // Single-color pie: auto-generate monochrome shades
      var radialColors;
      if (data.color && !data.colors) {
        radialColors = generatePalette(data.color, 'monochrome', values.length);
      } else {
        radialColors = getActivePalette(data, values.length);
      }
      return [{
        data: values,
        backgroundColor: radialColors,
        borderWidth: isDark() ? 1 : 2,
        borderColor: isDark() ? 'rgba(0,0,0,0.3)' : '#fff'
      }];
    }

    var dsCount = data.datasets ? data.datasets.length : 1;

    if (data.values && !data.datasets) {
      // Simple single-dataset
      var c0 = data.color || paletteColor(data, 0, dsCount);
      var ds = {
        label: data.label || '',
        data: data.values,
        backgroundColor: isLine ? undefined : (data.colors || c0),
        borderColor: isLine || isScatter ? c0 : undefined,
        borderWidth: isLine ? 2.5 : 0,
        tension: data.tension != null ? data.tension : 0.35,
        fill: isFill,
        pointRadius: isLine ? 3 : undefined,
        pointHoverRadius: isLine ? 5 : undefined
      };
      if (isFill) {
        ds.backgroundColor = hexToRgba(c0, 0.15);
        ds.borderColor = c0;
      }
      return [ds];
    }

    if (data.datasets) {
      return data.datasets.map(function (ds, i) {
        var color = ds.color || paletteColor(data, i, dsCount);
        var dsType = isMixed ? (ds.type || 'bar') : undefined;
        var isLineLike = isLine || dsType === 'line' || chartType === 'radar';
        var result = {
          label: ds.label || '',
          data: ds.values || ds.data || [],
          backgroundColor: isLineLike && isFill ? hexToRgba(color, 0.15) : (isLineLike ? undefined : (ds.colors || color)),
          borderColor: isLineLike || isScatter || isBubble ? color : undefined,
          borderWidth: isLineLike ? 2.5 : 0,
          tension: ds.tension != null ? ds.tension : 0.35,
          fill: ds.fill != null ? ds.fill : isFill,
          pointRadius: isLineLike ? 3 : undefined,
          pointHoverRadius: isLineLike ? 5 : undefined,
          order: ds.order != null ? ds.order : undefined
        };
        if (isMixed && dsType) result.type = dsType;
        if (ds.yAxisID) result.yAxisID = ds.yAxisID;
        if (isBubble && !ds.data) {
          // Convert separate arrays to {x, y, r} format
          if (ds.x && ds.y && ds.r) {
            result.data = ds.x.map(function (xv, j) {
              return { x: xv, y: ds.y[j], r: ds.r[j] || 5 };
            });
          }
        }
        return result;
      });
    }

    return null;
  }

  // ── Hex to rgba ──
  function hexToRgba(hex, alpha) {
    if (!hex || hex.charAt(0) !== '#') return hex;
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  // ── Build scales ──
  function buildScales(data, chartType, th) {
    var noScales = chartType === 'pie' || chartType === 'doughnut' ||
                   chartType === 'polarArea' || chartType === 'radar';
    if (noScales) return undefined;

    var isHorizontal = chartType === 'horizontalBar' || chartType === 'stackedHBar';
    var isStacked = chartType === 'stackedBar' || chartType === 'stackedHBar' ||
                    chartType === 'stackedArea' || data.stacked;

    var tickCb = makeTickCallback(data.format, data.prefix, data.suffix);

    var xScale = {
      title: {
        display: !!(data.xAxis || data.xLabel),
        text: data.xAxis || data.xLabel || '',
        color: th.text
      },
      ticks: { color: th.text },
      grid: { color: th.grid },
      stacked: isStacked || undefined
    };

    var yScale = {
      title: {
        display: !!(data.yAxis || data.yLabel),
        text: data.yAxis || data.yLabel || '',
        color: th.text
      },
      ticks: { color: th.text },
      grid: { color: th.grid },
      beginAtZero: data.beginAtZero !== false,
      stacked: isStacked || undefined
    };

    // Axis-specific options
    var valueAxis = isHorizontal ? xScale : yScale;
    if (tickCb) valueAxis.ticks.callback = tickCb;
    if (data.min != null) valueAxis.min = data.min;
    if (data.max != null) valueAxis.max = data.max;
    if (data.stepSize != null) valueAxis.ticks.stepSize = data.stepSize;

    var scales = { x: xScale, y: yScale };

    // Dual y-axis
    if (data.y2Axis || data.y2Label || data.dualAxis) {
      scales.y2 = {
        position: 'right',
        title: {
          display: !!(data.y2Axis || data.y2Label),
          text: data.y2Axis || data.y2Label || '',
          color: th.text
        },
        ticks: { color: th.text },
        grid: { drawOnChartArea: false },
        beginAtZero: data.beginAtZero !== false
      };
      var tickCb2 = makeTickCallback(data.y2Format, data.y2Prefix, data.y2Suffix);
      if (tickCb2) scales.y2.ticks.callback = tickCb2;
    }

    return scales;
  }

  // ── Build annotation plugin config ──
  function buildAnnotations(data, th) {
    if (!data.annotations || !data.annotations.length) return undefined;
    var annots = {};
    data.annotations.forEach(function (a, i) {
      var isHorizontal = a.axis === 'y' || a.type === 'horizontal' || a.y != null;
      annots['ann' + i] = {
        type: 'line',
        scaleID: isHorizontal ? 'y' : 'x',
        value: isHorizontal ? (a.y || a.value) : (a.x || a.value),
        borderColor: a.color || th.annotationColor,
        borderWidth: a.width || 2,
        borderDash: a.dashed !== false ? [6, 4] : [],
        label: a.label ? {
          display: true,
          content: a.label,
          position: a.position || 'end',
          backgroundColor: 'transparent',
          color: a.labelColor || th.annotationLabel,
          font: { size: 12, weight: '500' }
        } : undefined
      };
    });
    return { annotations: annots };
  }

  // ── Build datalabels plugin config ──
  function buildDatalabels(data, chartType, th) {
    if (data.dataLabels === false) return { display: false };

    var isRadial = chartType === 'pie' || chartType === 'doughnut' || chartType === 'polarArea';
    var isScatterLike = chartType === 'scatter' || chartType === 'bubble';
    var isRadar = chartType === 'radar';

    // Hide labels on scatter/bubble — too cluttered
    if (isScatterLike) return { display: false };

    if (isRadial) {
      return {
        display: true,
        color: '#fff',
        font: { weight: '600', size: 12 },
        textShadowColor: 'rgba(0,0,0,0.3)',
        textShadowBlur: 4,
        formatter: function (value, ctx) {
          var total = ctx.dataset.data.reduce(function (a, b) { return a + b; }, 0);
          var pct = Math.round(value / total * 100);
          if (pct < 5) return '';  // hide tiny slices
          return pct + '%';
        }
      };
    }

    if (isRadar) {
      return {
        display: true,
        color: th.text,
        font: { size: 10 },
        align: 'end',
        offset: 4,
        formatter: function (value) { return value; }
      };
    }

    // Bar, line, area — show values
    var tickCb = makeTickCallback(data.format, data.prefix, data.suffix);
    return {
      display: true,
      color: th.text,
      font: { size: 11, weight: '500' },
      anchor: 'end',
      align: 'end',
      offset: 2,
      formatter: function (value) {
        if (tickCb) return tickCb(value);
        return value;
      }
    };
  }

  // ── Build Chart.js config ──
  function buildConfig(data) {
    var rawType = normalizeType(data.type);
    var th = theme();

    // Map our types to Chart.js types + options
    var chartJsType = rawType;
    var isHorizontal = false;
    if (rawType === 'horizontalBar' || rawType === 'stackedHBar') {
      chartJsType = 'bar';
      isHorizontal = true;
    } else if (rawType === 'stackedBar') {
      chartJsType = 'bar';
    } else if (rawType === 'area' || rawType === 'stackedArea') {
      chartJsType = 'line';
    } else if (rawType === 'mixed') {
      chartJsType = 'bar'; // base type for mixed, datasets override individually
    }

    var datasets = buildDatasets(data, rawType);
    if (!datasets) return null;

    var isRadial = rawType === 'pie' || rawType === 'doughnut' || rawType === 'polarArea';
    var isRadar = rawType === 'radar';
    var showLegend = data.legend !== false && (isRadial || datasets.length > 1 || rawType === 'mixed');

    // Legend position
    var legendPos = data.legendPosition || 'bottom';

    var config = {
      type: chartJsType,
      data: { labels: data.labels || [], datasets: datasets },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        animation: false,
        font: th.font ? { family: th.font } : undefined,
        aspectRatio: data.aspectRatio || undefined,
        indexAxis: isHorizontal ? 'y' : undefined,
        plugins: {
          title: {
            display: !!data.title,
            text: data.title || '',
            color: th.title,
            font: { size: 15, weight: '600', family: th.font || undefined },
            padding: { bottom: data.subtitle ? 2 : 12 }
          },
          subtitle: {
            display: !!data.subtitle,
            text: data.subtitle || '',
            color: th.text,
            font: { size: 12, weight: '400' },
            padding: { bottom: 12 }
          },
          legend: {
            display: showLegend,
            position: legendPos,
            labels: { color: th.text, usePointStyle: true, padding: 16 }
          },
          tooltip: {
            backgroundColor: th.tooltipBg,
            titleColor: th.title,
            bodyColor: th.text,
            borderColor: th.tooltipBorder,
            borderWidth: 1,
            cornerRadius: 6,
            padding: 10
          },
          datalabels: buildDatalabels(data, rawType, th)
        },
        scales: buildScales(data, rawType, th)
      }
    };

    // Radar scale styling
    if (isRadar) {
      config.options.scales = {
        r: {
          ticks: { color: th.text, backdropColor: 'transparent' },
          grid: { color: th.grid },
          pointLabels: { color: th.text, font: { size: 12 } },
          beginAtZero: data.beginAtZero !== false
        }
      };
    }

    // Annotations (requires annotation plugin — use inline plugin)
    var annots = buildAnnotations(data, th);
    if (annots) {
      config.options.plugins.annotation = annots;
    }

    return config;
  }

  // ── Destroy all active charts (called before re-render) ──
  function destroyAll() {
    activeCharts.forEach(function (c) { c.destroy(); });
    activeCharts = [];
    chartDataStore = [];
  }

  // ── Process rendered HTML: find chart code blocks, replace with canvases ──
  function processCharts(container) {
    var chartBlocks = container.querySelectorAll('code.language-chart');
    if (!chartBlocks.length) return;

    ensureChartJs(function () {
      chartBlocks.forEach(function (codeEl) {
        var pre = codeEl.closest('pre');
        if (!pre) return;

        var data = parseChartData(codeEl.textContent);
        if (!data) {
          pre.classList.add('sdoc-chart-error');
          return;
        }

        var config = buildConfig(data);
        if (!config) return;

        var wrapper = document.createElement('div');
        wrapper.className = 'sdoc-chart';
        var canvas = document.createElement('canvas');
        wrapper.appendChild(canvas);

        var preWrapper = pre.closest('.pre-wrapper');
        var target = preWrapper || pre;
        target.parentNode.replaceChild(wrapper, target);

        var chart = new Chart(canvas, config);
        activeCharts.push(chart);
      });
    });
  }

  // ── Re-render charts when palette controls change ──
  // Store chart data alongside instances so we can rebuild with new colors
  var chartDataStore = [];

  var _origProcess = processCharts;
  processCharts = function (container) {
    chartDataStore = [];
    var chartBlocks = container.querySelectorAll('code.language-chart');
    if (!chartBlocks.length) return;

    ensureChartJs(function () {
      chartBlocks.forEach(function (codeEl) {
        var pre = codeEl.closest('pre');
        if (!pre) return;
        var data = parseChartData(codeEl.textContent);
        if (!data) { pre.classList.add('sdoc-chart-error'); return; }
        var config = buildConfig(data);
        if (!config) return;

        var wrapper = document.createElement('div');
        wrapper.className = 'sdoc-chart';
        var canvas = document.createElement('canvas');
        wrapper.appendChild(canvas);

        var preWrapper = pre.closest('.pre-wrapper');
        var target = preWrapper || pre;
        target.parentNode.replaceChild(wrapper, target);

        var chart = new Chart(canvas, config);
        activeCharts.push(chart);
        chartDataStore.push({ chart: chart, data: data, canvas: canvas });
      });
    });
  };

  function refreshChartColors() {
    chartDataStore.forEach(function (entry) {
      entry.chart.destroy();
      var config = buildConfig(entry.data);
      entry.chart = new Chart(entry.canvas, config);
    });
    // Update activeCharts
    activeCharts = chartDataStore.map(function (e) { return e.chart; });
  }

  ['ctrl-chart-accent', 'ctrl-chart-palette'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', refreshChartColors);
      el.addEventListener('change', refreshChartColors);
    }
  });

  // ── Public API ──
  S.destroyCharts = destroyAll;
  S.processCharts = processCharts;
})();
