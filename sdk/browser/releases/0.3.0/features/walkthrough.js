import { loadScript, loadStyle, vendorAsset } from '../assets.js';
import { lexMarkdown, parseMarkdown, setKnownHTML, setSanitizedHTML } from '../runtime.js';

const PREVIOUS_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
const NEXT_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
const RESTART_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>';

function createController(context, modelApi) {
  let model = { steps: [], total: 0 };
  let currentIndex = -1;
  let resolvedByStep = [];
  let destroyed = false;

  function topLevelMatches(selector) {
    return Array.from(context.root.querySelectorAll(selector)).filter((element) => {
      let parent = element.parentElement;
      while (parent && parent !== context.root) {
        if (parent.matches && parent.matches(
          'p, pre, blockquote, ul, ol, h1, h2, h3, h4, h5, h6, table, .sdoc-chart')) {
          return false;
        }
        parent = parent.parentElement;
      }
      return true;
    });
  }

  function strip() {
    context.root.querySelectorAll('.sdoc-docwalk-card, .sdoc-docwalk-stack')
      .forEach((element) => element.remove());
    context.root.querySelectorAll('.sdoc-docwalk-inline').forEach((span) => {
      const parent = span.parentNode;
      if (!parent) return;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      span.remove();
      parent.normalize();
    });
    context.root.querySelectorAll('.sdoc-docwalk-target, .sdoc-docwalk-target-active')
      .forEach((element) => element.classList.remove(
        'sdoc-docwalk-target', 'sdoc-docwalk-target-active'));
    context.root.querySelectorAll('.sdoc-docwalk-code').forEach((surface) => surface.remove());
    context.root.querySelectorAll('pre.sdoc-docwalk-code-source').forEach((pre) => {
      pre.classList.remove('sdoc-docwalk-code-source');
      pre.removeAttribute('data-docwalk-pre-index');
    });
  }

  function plainInline(source) {
    if (!source) return '';
    const holder = document.createElement('div');
    setSanitizedHTML(holder, parseMarkdown(source));
    return (holder.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function findBlock(target) {
    const selector = target.type === 'chart' ? '.sdoc-chart' : target.type;
    return topLevelMatches(selector)[target.index] || null;
  }

  function wrapRange(range) {
    if (!range || range.collapsed) return null;
    const span = document.createElement('span');
    span.className = 'sdoc-docwalk-inline sdoc-docwalk-target';
    try {
      range.surroundContents(span);
    } catch (_) {
      try {
        const fragment = range.extractContents();
        span.appendChild(fragment);
        range.insertNode(span);
      } catch (__) {
        return null;
      }
    }
    return span;
  }

  function textRangeForQuote(root, quote) {
    if (!root || !quote) return null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let text = '';
    let node;
    while ((node = walker.nextNode())) {
      nodes.push({ node, start: text.length, end: text.length + node.nodeValue.length });
      text += node.nodeValue;
    }
    const at = text.indexOf(quote);
    if (at < 0) return null;
    const end = at + quote.length;
    const startNode = nodes.find((entry) => at >= entry.start && at < entry.end);
    const endNode = nodes.find((entry) => end > entry.start && end <= entry.end);
    if (!startNode || !endNode) return null;
    const range = document.createRange();
    range.setStart(startNode.node, at - startNode.start);
    range.setEnd(endNode.node, end - endNode.start);
    return range;
  }

  function splitHighlightedLines(html) {
    const lines = String(html).split('\n');
    const open = [];
    return lines.map((line) => {
      const prefix = open.join('');
      const pattern = /<span\b[^>]*>|<\/span>/g;
      let match;
      while ((match = pattern.exec(line))) {
        if (match[0] === '</span>') open.pop();
        else open.push(match[0]);
      }
      return prefix + line + '</span>'.repeat(open.length);
    });
  }

  function codeSurface(pre, target) {
    const wrapper = pre && pre.closest ? pre.closest('.pre-wrapper') : null;
    if (!wrapper) return null;
    const existing = wrapper.querySelector(
      '.sdoc-docwalk-code[data-pre-index="' + target.index + '"]');
    if (existing) return existing;
    const code = pre.querySelector('code');
    if (!code) return null;
    const parts = splitHighlightedLines(code.innerHTML).slice(0, target.codeLineCount);
    while (parts.length < target.codeLineCount) parts.push('');
    const surface = document.createElement('div');
    surface.className = 'sdoc-docwalk-code';
    surface.dataset.preIndex = String(target.index);
    surface.setAttribute('role', 'region');
    surface.setAttribute('aria-label', 'Annotated code');
    parts.forEach((html, index) => {
      const row = document.createElement('div');
      row.className = 'sdoc-docwalk-code-row';
      row.dataset.codeLine = String(index + 1);
      const number = document.createElement('span');
      number.className = 'sdoc-docwalk-code-number';
      number.textContent = String(index + 1);
      const text = document.createElement('span');
      text.className = 'sdoc-docwalk-code-text';
      setKnownHTML(text, html || ' ');
      row.append(number, text);
      surface.appendChild(row);
    });
    pre.classList.add('sdoc-docwalk-code-source');
    pre.dataset.docwalkPreIndex = String(target.index);
    wrapper.insertBefore(surface, pre);
    return surface;
  }

  function resolveCodeTarget(pre, target) {
    const surface = codeSurface(pre, target);
    if (!surface) return null;
    const marks = [];
    const first = target.codeLine || 1;
    const last = target.codeEndLine || first;
    for (let line = first; line <= last; line += 1) {
      const row = surface.querySelector(
        '.sdoc-docwalk-code-row[data-code-line="' + line + '"]');
      if (!row) continue;
      row.classList.add('sdoc-docwalk-code-mark', 'sdoc-docwalk-target');
      marks.push(row);
    }
    if (!marks.length) return null;
    if (target.quote) {
      for (const mark of marks) {
        const text = mark.querySelector('.sdoc-docwalk-code-text');
        const token = wrapRange(textRangeForQuote(text, target.quote));
        if (!token) continue;
        marks.forEach((entry) => entry.classList.remove('sdoc-docwalk-target'));
        token.classList.add('sdoc-docwalk-code-token');
        return { element: marks[marks.length - 1], marks: [token] };
      }
    }
    return { element: marks[marks.length - 1], marks };
  }

  function resolveTarget(target) {
    let element = null;
    if (target.kind === 'block') element = findBlock(target);
    else if (target.kind === 'rich') {
      element = context.root.querySelectorAll(target.selector)[target.index] || null;
    }
    if (!element) return null;
    if (target.code) return resolveCodeTarget(element, target);
    if (target.kind === 'rich' && target.selector === '.sdoc-cells') {
      const pane = element.closest('.sdoc-cells-pane');
      const mark = pane || element;
      mark.classList.add('sdoc-docwalk-target');
      return { element, mark };
    }
    if (target.kind === 'block' && target.inline && target.source) {
      const mark = wrapRange(textRangeForQuote(element, plainInline(target.source)));
      if (mark) return { element, mark };
    }
    element.classList.add('sdoc-docwalk-target');
    return { element, mark: element };
  }

  function insertionAnchor(element) {
    if (!element) return null;
    if (element.classList.contains('sdoc-docwalk-code-row')) return element;
    return element.closest('.sdoc-cells-pane, .sdoc-table-host, .md-table-scroll, .sdoc-block-host, .pre-wrapper')
      || element;
  }

  function stackAfter(anchor, stacks) {
    if (!anchor || !anchor.parentNode) return null;
    const existing = stacks.find((entry) => entry.anchor === anchor);
    if (existing) return existing.stack;
    const stack = document.createElement('div');
    stack.className = 'sdoc-docwalk-stack';
    anchor.parentNode.insertBefore(stack, anchor.nextSibling);
    stacks.push({ anchor, stack });
    return stack;
  }

  function navButton(action, label, disabled) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sdoc-docwalk-nav sdoc-walkthrough-nav is-' + action;
    button.dataset.docwalk = action;
    button.disabled = disabled;
    if (action === 'prev') setKnownHTML(button, PREVIOUS_ICON + '<span>' + label + '</span>');
    else if (action === 'next') setKnownHTML(button, '<span>' + label + '</span>' + NEXT_ICON);
    else {
      button.title = 'Back to start';
      button.setAttribute('aria-label', 'Back to the first step');
      setKnownHTML(button, RESTART_ICON);
    }
    return button;
  }

  function cardFor(step) {
    const card = document.createElement('aside');
    card.className = 'sdoc-docwalk-card sdoc-walkthrough-card';
    if (step.index === model.total - 1) card.classList.add('is-last');
    card.dataset.docwalkStep = String(step.index);
    const body = document.createElement('div');
    body.className = 'sdoc-docwalk-note';
    setSanitizedHTML(body, parseMarkdown(step.text));
    const footer = document.createElement('div');
    footer.className = 'sdoc-docwalk-step sdoc-walkthrough-step';
    footer.appendChild(navButton('prev', 'Prev', step.index === 0));
    const position = document.createElement('span');
    position.className = 'sdoc-docwalk-position sdoc-walkthrough-position';
    position.textContent = 'Step ' + (step.index + 1) + ' of ' + model.total;
    const actions = document.createElement('span');
    actions.className = 'sdoc-docwalk-actions sdoc-walkthrough-actions';
    actions.append(navButton('restart', '', step.index === 0));
    actions.append(navButton('next', 'Next', step.index === model.total - 1));
    footer.append(position, actions);
    card.append(body, footer);
    return card;
  }

  function revealSections(element) {
    let body = element && element.closest ? element.closest('.md-section-body') : null;
    while (body) {
      body.classList.add('open');
      const section = body.closest('.md-section');
      const heading = section && section.querySelector(
        ':scope > h2, :scope > h3, :scope > h4, :scope > .sdoc-block-host > h2, :scope > .sdoc-block-host > h3, :scope > .sdoc-block-host > h4');
      const toggle = heading && heading.querySelector(':scope > .section-toggle');
      if (toggle) toggle.classList.add('open');
      body = section && section.parentElement
        ? section.parentElement.closest('.md-section-body')
        : null;
    }
  }

  function revealCells(element) {
    const pane = element && element.closest ? element.closest('.sdoc-cells-pane') : null;
    if (!pane) return;
    const sheets = Array.from(pane.querySelectorAll('.sdoc-cells'));
    const index = sheets.indexOf(element.closest('.sdoc-cells'));
    const tabs = pane.querySelectorAll('.sdoc-cells-pane-tab');
    if (index >= 0 && tabs[index] && !tabs[index].classList.contains('is-active')) tabs[index].click();
  }

  function syncActive(scroll) {
    if (destroyed) return;
    context.root.querySelectorAll('.sdoc-docwalk-target-active')
      .forEach((element) => element.classList.remove('sdoc-docwalk-target-active'));
    context.root.querySelectorAll('.sdoc-docwalk-card.is-active')
      .forEach((element) => element.classList.remove('is-active'));
    const resolved = resolvedByStep[currentIndex] || [];
    resolved.forEach((item) => {
      (item.marks || [item.mark]).filter(Boolean)
        .forEach((mark) => mark.classList.add('sdoc-docwalk-target-active'));
    });
    const card = context.root.querySelector(
      '.sdoc-docwalk-card[data-docwalk-step="' + currentIndex + '"]');
    if (card) card.classList.add('is-active');
    if (!scroll) return;
    const target = resolved[0] && resolved[0].element;
    if (target) {
      revealSections(target);
      revealCells(target);
    }
    requestAnimationFrame(() => {
      const destination = card || target;
      if (destination && destination.isConnected) {
        destination.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }

  function goTo(index, options) {
    if (!model.total || destroyed) return;
    currentIndex = modelApi.clamp(index, model.total);
    syncActive(!(options && options.scroll === false));
  }

  function codeContextForPre(pre) {
    if (destroyed || !pre) return null;
    const rawIndex = pre.dataset.docwalkPreIndex;
    const selectedKey = rawIndex == null ? '' : 'pre:' + rawIndex;
    if (!selectedKey) return null;
    const byFile = Object.create(null);
    const preByFile = Object.create(null);
    const stepFile = Object.create(null);
    context.root.querySelectorAll('pre[data-docwalk-pre-index]').forEach((entry) => {
      preByFile['pre:' + entry.dataset.docwalkPreIndex] = entry;
    });
    model.steps.forEach((step) => {
      step.targets.forEach((target) => {
        if (!target.code) return;
        const key = 'pre:' + target.index;
        const note = {
          line: target.codeLine,
          endLine: target.codeEndLine,
          text: step.text,
          quote: target.quote || '',
          index: step.index,
        };
        (byFile[key] || (byFile[key] = [])).push(note);
        if (stepFile[step.index] == null) stepFile[step.index] = key;
      });
    });
    const selected = byFile[selectedKey] || [];
    if (!selected.length) return null;
    let stepIndex = currentIndex;
    if (!selected.some((note) => note.index === stepIndex)) stepIndex = selected[0].index;
    return {
      steps: model.steps,
      byFile,
      preByFile,
      stepFile,
      stepIndex,
      selectedKey,
    };
  }

  function handleClick(event) {
    const button = event.target.closest('[data-docwalk]');
    if (!button || !context.root.contains(button) || button.disabled) return;
    const action = button.dataset.docwalk;
    if (action === 'prev') goTo(currentIndex - 1);
    else if (action === 'next') goTo(currentIndex + 1);
    else if (action === 'restart') goTo(0);
  }

  function handleKey(event) {
    if (!model.total || event.defaultPrevented || event.metaKey || event.ctrlKey ||
        event.altKey || event.shiftKey) return;
    const target = event.target;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    if (document.querySelector('.sdoc-code-focus, .sdoc-present, .sdoc-mermaid-focus')) return;
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      goTo(currentIndex + 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      goTo(currentIndex - 1);
    }
  }

  function render() {
    strip();
    model = modelApi.build(context.meta, context.body, lexMarkdown);
    currentIndex = modelApi.clamp(0, model.total);
    resolvedByStep = [];
    const stacks = [];
    model.steps.forEach((step) => {
      const resolved = step.targets.map(resolveTarget).filter(Boolean);
      resolvedByStep[step.index] = resolved;
      if (!resolved.length) return;
      const anchor = insertionAnchor(resolved[resolved.length - 1].element);
      const stack = stackAfter(anchor, stacks);
      if (stack) stack.appendChild(cardFor(step));
    });
    syncActive(false);
  }

  const api = {
    render,
    goTo,
    active: () => !destroyed && model.total > 0,
    model: () => model,
    currentIndex: () => currentIndex,
    codeContextForPre,
  };

  context.root.addEventListener('click', handleClick);
  context.root.addEventListener('keydown', handleKey);
  render();
  if (context.codeFocus) context.codeFocus.adapter.docwalk = api;

  return function destroy() {
    if (destroyed) return;
    destroyed = true;
    context.root.removeEventListener('click', handleClick);
    context.root.removeEventListener('keydown', handleKey);
    if (context.codeFocus && context.codeFocus.adapter.docwalk === api) {
      delete context.codeFocus.adapter.docwalk;
    }
    strip();
    model = { steps: [], total: 0 };
    resolvedByStep = [];
  };
}

export async function mount(context) {
  const [modelApi] = await Promise.all([
    loadScript(vendorAsset('sdocs-docwalk.js'), () => window.SDocDocwalk),
    loadStyle(vendorAsset('sdocs-docwalk.css'), 'smalldocs-sdk-docwalk-styles'),
    loadStyle(vendorAsset('sdocs-walkthrough.css'), 'smalldocs-sdk-walkthrough-styles'),
  ]);
  if (context.signal.aborted) return;
  return createController(context, modelApi);
}
