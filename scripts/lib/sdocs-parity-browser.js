'use strict';

function scopeFor(page, config, within) {
  if (!within) return page;
  const selector = config.scopes && config.scopes[within]
    ? config.scopes[within]
    : within === 'presentation'
      ? config.presentationRoot
      : within;
  return page.locator(selector).first();
}

function locatorFor(page, config, target) {
  const scope = scopeFor(page, config, target.within);
  if (target.role) return scope.getByRole(target.role, { name: target.name, exact: true });
  if (!target.selector) throw new Error('Interaction target needs a selector or role');
  return scope.locator(target.selector);
}

function targetName(step) {
  return step.name || step.selector || step.role || step.key || step.action;
}

async function resetInteractionState(page) {
  await page.mouse.move(1, 1);
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active && active !== document.body && typeof active.blur === 'function') active.blur();
  });
}

async function focusWithKeyboard(page, locator, step) {
  const target = locator.first();
  const count = await locator.count();
  if (count < 1) throw new Error('Focus target not found: ' + targetName(step));
  const maxTabs = step.maxTabs == null ? 120 : step.maxTabs;
  const key = step.reverse ? 'Shift+Tab' : 'Tab';
  for (let index = 0; index < maxTabs; index += 1) {
    await page.keyboard.press(key);
    const reached = await target.evaluate((node) => node === document.activeElement);
    if (reached) return;
  }
  throw new Error('Keyboard focus did not reach ' + targetName(step) + ' after ' + maxTabs + ' tabs');
}

async function replayStep(page, step, config) {
  if (step.action === 'press') {
    await page.keyboard.press(step.key);
    return;
  }
  if (step.action === 'blur') {
    await page.evaluate(() => {
      if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur();
    });
    return;
  }
  const locator = locatorFor(page, config, step);
  if (step.action === 'focus' && step.via === 'keyboard') {
    await focusWithKeyboard(page, locator, step);
    return;
  }
  if (await locator.count() < 1) throw new Error('Control not found: ' + targetName(step));
  const target = locator.first();
  if (step.action === 'click') {
    await target.click();
    if (step.keepPointer !== true) await page.mouse.move(1, 1);
  }
  else if (step.action === 'doubleClick') {
    await target.dblclick();
    if (step.keepPointer !== true) await page.mouse.move(1, 1);
  }
  else if (step.action === 'hover') await target.hover();
  else if (step.action === 'focus') await target.focus();
  else if (step.action === 'fill') await target.fill(step.value);
  else if (step.action === 'type') await target.pressSequentially(step.text, { delay: step.delay || 0 });
  else throw new Error('Unsupported action: ' + step.action);
}

module.exports = {
  locatorFor,
  replayStep,
  resetInteractionState,
  scopeFor,
};
