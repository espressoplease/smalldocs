import { createRenderer } from './core.js';

export async function render(target, markdown, options) {
  return createRenderer(target, markdown, options);
}

export const SmallDocs = Object.freeze({ render });
export default SmallDocs;
