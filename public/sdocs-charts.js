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

  // ── HSL helpers (shared from sdocs-styles.js) ──
  var hexToHsl = SDocStyles.hexToHsl;
  var hslToHex = SDocStyles.hslToHex;

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
      var rendered = document.getElementById('_sd_rendered');
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
    var rendered = document.getElementById('_sd_rendered');
    if (!rendered) return '';
    return getComputedStyle(rendered).getPropertyValue('--md-font-family').trim() || '';
  }

  function cssVar(name) {
    var rendered = document.getElementById('_sd_rendered');
    if (!rendered) return '';
    return getComputedStyle(rendered).getPropertyValue(name).trim();
  }

  function theme() {
    var dark = isDark();
    var chartText = cssVar('--md-chart-text');
    var chartBg = cssVar('--md-chart-bg');
    var textColor = chartText || (dark ? '#A8A29E' : '#78716c');
    var titleColor = chartText || (dark ? '#E7E5E2' : '#1C1917');
    // Grid: semi-transparent version of the text color
    var gridColor;
    if (chartText) {
      gridColor = hexToRgba(chartText, 0.15);
    } else {
      gridColor = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
    }
    return {
      font: getDocFont(),
      text: textColor,
      grid: gridColor,
      title: titleColor,
      tooltipBg: chartBg || (dark ? '#292524' : '#fff'),
      tooltipBorder: chartText ? hexToRgba(chartText, 0.2) : (dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'),
      annotationColor: chartText ? hexToRgba(chartText, 0.4) : (dark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)'),
      annotationLabel: titleColor
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
      clip: false,
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
        layout: { padding: { top: 20 } },
        font: th.font ? { family: th.font } : undefined,
        aspectRatio: data.aspectRatio || undefined,
        indexAxis: isHorizontal ? 'y' : undefined,
        plugins: {
          title: {
            display: !!data.title,
            text: data.title || '',
            color: th.title,
            font: { size: 15, weight: '600', family: th.font || undefined },
            padding: { bottom: data.subtitle ? 2 : 23 }
          },
          subtitle: {
            display: !!data.subtitle,
            text: data.subtitle || '',
            color: th.text,
            font: { size: 12, weight: '400' },
            padding: { bottom: 24 }
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

        var chartIndex = chartDataStore.length;
        var wrapper = document.createElement('div');
        wrapper.className = 'sdoc-chart';
        wrapper.setAttribute('data-chart-index', chartIndex);
        var canvas = document.createElement('canvas');
        wrapper.appendChild(canvas);
        wrapper.appendChild(buildChartMenu(data, chartIndex));

        var preWrapper = pre.closest('.pre-wrapper');
        var target = preWrapper || pre;
        target.parentNode.replaceChild(wrapper, target);

        var chart = new Chart(canvas, config);
        activeCharts.push(chart);
        chartDataStore.push({ chart: chart, data: data, canvas: canvas, wrapper: wrapper });
      });
    });
  };

  // ── Type families for type switching ──
  var TYPE_FAMILIES = {
    bar: [['bar', 'Bar'], ['horizontal_bar', 'Horizontal'], ['stacked_bar', 'Stacked']],
    horizontalBar: [['bar', 'Bar'], ['horizontal_bar', 'Horizontal'], ['stacked_bar', 'Stacked']],
    stackedBar: [['bar', 'Bar'], ['horizontal_bar', 'Horizontal'], ['stacked_bar', 'Stacked']],
    line: [['line', 'Line'], ['area', 'Area'], ['stacked_area', 'Stacked']],
    area: [['line', 'Line'], ['area', 'Area'], ['stacked_area', 'Stacked']],
    stackedArea: [['line', 'Line'], ['area', 'Area'], ['stacked_area', 'Stacked']],
    pie: [['pie', 'Pie'], ['doughnut', 'Doughnut'], ['polarArea', 'Polar']],
    doughnut: [['pie', 'Pie'], ['doughnut', 'Doughnut'], ['polarArea', 'Polar']],
    polarArea: [['pie', 'Pie'], ['doughnut', 'Doughnut'], ['polarArea', 'Polar']],
  };

  function _el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  function buildChartMenu(data, chartIndex) {
    var frag = document.createDocumentFragment();
    var btn = _el('button', 'chart-menu-btn');
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>';
    btn.title = 'Chart options';
    btn.setAttribute('data-chart-index', chartIndex);
    frag.appendChild(btn);

    var menu = _el('div', 'chart-menu');
    menu.setAttribute('data-chart-index', chartIndex);

    var copyBtn = _el('button', 'chart-menu-item', 'Copy as image');
    copyBtn.setAttribute('data-action', 'copy-png');
    menu.appendChild(copyBtn);
    var dlBtn = _el('button', 'chart-menu-item', 'Download as PNG');
    dlBtn.setAttribute('data-action', 'download-png');
    menu.appendChild(dlBtn);
    menu.appendChild(_el('div', 'chart-menu-sep'));

    var rawType = normalizeType(data.type);
    var isRadial = rawType === 'pie' || rawType === 'doughnut' || rawType === 'polarArea';

    if (!isRadial) {
      var lbl = document.createElement('label');
      lbl.className = 'chart-menu-toggle';
      var cb1 = document.createElement('input');
      cb1.type = 'checkbox'; cb1.setAttribute('data-field', 'dataLabels'); cb1.checked = data.dataLabels !== false;
      lbl.appendChild(cb1); lbl.appendChild(document.createTextNode(' Data labels'));
      menu.appendChild(lbl);
    }
    var lbl2 = document.createElement('label');
    lbl2.className = 'chart-menu-toggle';
    var cb2 = document.createElement('input');
    cb2.type = 'checkbox'; cb2.setAttribute('data-field', 'legend'); cb2.checked = data.legend !== false;
    lbl2.appendChild(cb2); lbl2.appendChild(document.createTextNode(' Legend'));
    menu.appendChild(lbl2);
    menu.appendChild(_el('div', 'chart-menu-sep'));

    var family = TYPE_FAMILIES[rawType];
    if (family) {
      var tg = _el('div', 'chart-menu-types');
      family.forEach(function (pair) {
        var tb = _el('button', 'chart-type-btn', pair[1]);
        tb.setAttribute('data-type', pair[0]);
        if (normalizeType(pair[0]) === rawType) tb.classList.add('active');
        tg.appendChild(tb);
      });
      menu.appendChild(tg);
      menu.appendChild(_el('div', 'chart-menu-sep'));
    }

    var ti = document.createElement('input');
    ti.className = 'chart-menu-input'; ti.setAttribute('data-field', 'title');
    ti.placeholder = 'Title'; ti.value = data.title || '';
    menu.appendChild(ti);
    var si = document.createElement('input');
    si.className = 'chart-menu-input'; si.setAttribute('data-field', 'subtitle');
    si.placeholder = 'Subtitle'; si.value = data.subtitle || '';
    menu.appendChild(si);

    frag.appendChild(menu);
    return frag;
  }

  // ── Replace the Nth ```chart block in markdown ──
  function replaceChartBlock(body, index, newJson) {
    var count = -1;
    return body.replace(/```chart\n([\s\S]*?)```/g, function (match) {
      count++;
      if (count === index) return '```chart\n' + newJson + '\n```';
      return match;
    });
  }

  function rebuildChart(index) {
    var entry = chartDataStore[index];
    if (!entry) return;
    entry.chart.destroy();
    var config = buildConfig(entry.data);
    entry.chart = new Chart(entry.canvas, config);
    activeCharts = chartDataStore.map(function (e) { return e.chart; });
  }

  function persistChartChange(index) {
    var entry = chartDataStore[index];
    if (!entry) return;
    var json = JSON.stringify(entry.data, null, 2);
    S.currentBody = replaceChartBlock(S.currentBody, index, json);
    S.currentMeta = Object.assign({}, S.currentMeta, { styles: S.collectStyles() });
    S.rawEl.value = window.SDocYaml.serializeFrontMatter(S.currentMeta) + '\n' + S.currentBody;
    S._isDefaultState = false;
    S.syncAll('load');
  }

  // ── Chart menu event delegation ──
  document.addEventListener('click', function (e) {
    var menuBtn = e.target.closest('.chart-menu-btn');
    if (menuBtn) {
      e.stopPropagation();
      var menu = menuBtn.parentElement.querySelector('.chart-menu');
      var isOpen = menu.classList.contains('open');
      document.querySelectorAll('.chart-menu.open').forEach(function (m) { m.classList.remove('open'); });
      if (!isOpen) menu.classList.add('open');
      return;
    }
    var item = e.target.closest('.chart-menu-item');
    if (item) {
      e.stopPropagation();
      var action = item.getAttribute('data-action');
      var idx = parseInt(item.closest('.chart-menu').getAttribute('data-chart-index'));
      var entry = chartDataStore[idx];
      if (!entry) return;
      if (action === 'copy-png') {
        entry.canvas.toBlob(function (blob) {
          navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(function () {
            item.textContent = 'Copied!';
            setTimeout(function () { item.textContent = 'Copy as image'; }, 1500);
          });
        });
      } else if (action === 'download-png') {
        var link = document.createElement('a');
        link.download = (entry.data.title || 'chart').replace(/[^a-zA-Z0-9]/g, '_') + '.png';
        link.href = entry.canvas.toDataURL('image/png');
        link.click();
      }
      return;
    }
    var typeBtn = e.target.closest('.chart-type-btn');
    if (typeBtn) {
      e.stopPropagation();
      var idx = parseInt(typeBtn.closest('.chart-menu').getAttribute('data-chart-index'));
      var entry = chartDataStore[idx];
      if (!entry) return;
      entry.data.type = typeBtn.getAttribute('data-type');
      rebuildChart(idx);
      persistChartChange(idx);
      typeBtn.closest('.chart-menu-types').querySelectorAll('.chart-type-btn').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-type') === entry.data.type);
      });
      return;
    }
    if (!e.target.closest('.chart-menu')) {
      document.querySelectorAll('.chart-menu.open').forEach(function (m) { m.classList.remove('open'); });
    }
  });

  document.addEventListener('change', function (e) {
    if (e.target.type === 'checkbox' && e.target.closest('.chart-menu-toggle')) {
      var field = e.target.getAttribute('data-field');
      var idx = parseInt(e.target.closest('.chart-menu').getAttribute('data-chart-index'));
      var entry = chartDataStore[idx];
      if (!entry) return;
      if (e.target.checked) delete entry.data[field];
      else entry.data[field] = false;
      rebuildChart(idx);
      persistChartChange(idx);
      return;
    }
    if (e.target.classList && e.target.classList.contains('chart-menu-input')) {
      var field = e.target.getAttribute('data-field');
      var idx = parseInt(e.target.closest('.chart-menu').getAttribute('data-chart-index'));
      var entry = chartDataStore[idx];
      if (!entry) return;
      if (e.target.value.trim()) entry.data[field] = e.target.value.trim();
      else delete entry.data[field];
      rebuildChart(idx);
      persistChartChange(idx);
    }
  });

  function refreshChartColors() {
    chartDataStore.forEach(function (entry) {
      entry.chart.destroy();
      var config = buildConfig(entry.data);
      entry.chart = new Chart(entry.canvas, config);
    });
    // Update activeCharts
    activeCharts = chartDataStore.map(function (e) { return e.chart; });
  }

  ['_sd_ctrl-chart-accent', '_sd_ctrl-chart-palette'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', refreshChartColors);
      el.addEventListener('change', refreshChartColors);
    }
  });

  // ── Public API ──
  S.destroyCharts = destroyAll;
  S.processCharts = processCharts;
  S.refreshChartColors = refreshChartColors;
  S.replaceChartBlock = replaceChartBlock;
  S.getChartImages = function () {
    return chartDataStore.map(function (entry) {
      var chart = entry.chart;
      var prevDpr = chart.options.devicePixelRatio;
      var dataUrl;
      try {
        // Temporarily boost devicePixelRatio for crisper PDF export
        chart.options.devicePixelRatio = (window.devicePixelRatio || 1) * 2.5;
        chart.resize();
        dataUrl = chart.toBase64Image('image/png', 1);
      } catch (e) {
        dataUrl = chart.toBase64Image();
      } finally {
        // Restore
        chart.options.devicePixelRatio = prevDpr;
        chart.resize();
      }
      return { wrapper: entry.wrapper, dataUrl: dataUrl };
    });
  };
})();
