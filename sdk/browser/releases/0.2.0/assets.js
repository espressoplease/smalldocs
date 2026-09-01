import { trustedScriptURL } from './runtime.js';

const sdkModuleUrl = new URL(import.meta.url);

export const sdkOrigin = sdkModuleUrl.origin;
export const sdkVersionRoot = new URL('./', sdkModuleUrl);

const scriptPromises = new Map();
const stylePromises = new Map();
const ASSET_TIMEOUT_MS = 15000;

export function sdkAsset(path) {
  return new URL(path.replace(/^\//, ''), sdkVersionRoot).href;
}

export function vendorAsset(path) {
  return sdkAsset('vendor/' + path.replace(/^\//, ''));
}

export function loadScript(src, readApi) {
  if (scriptPromises.has(src)) return scriptPromises.get(src);

  const promise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = trustedScriptURL(src);
    script.async = true;
    script.dataset.smalldocsAsset = src;
    const timer = setTimeout(() => {
      scriptPromises.delete(src);
      script.remove();
      reject(new Error('SmallDocs asset timed out: ' + src));
    }, ASSET_TIMEOUT_MS);
    script.addEventListener('load', () => {
      clearTimeout(timer);
      const value = readApi ? readApi() : true;
      if (!value) {
        reject(new Error('SmallDocs asset loaded without its expected API: ' + src));
        return;
      }
      resolve(value);
    }, { once: true });
    script.addEventListener('error', () => {
      clearTimeout(timer);
      scriptPromises.delete(src);
      reject(new Error('SmallDocs asset could not be loaded: ' + src));
    }, { once: true });
    document.head.appendChild(script);
  });

  scriptPromises.set(src, promise);
  return promise;
}

export function loadStyle(href, id) {
  if (stylePromises.has(href)) return stylePromises.get(href);

  const promise = new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    if (id) link.id = id;
    link.dataset.smalldocsAsset = href;
    const timer = setTimeout(() => {
      stylePromises.delete(href);
      link.remove();
      reject(new Error('SmallDocs stylesheet timed out: ' + href));
    }, ASSET_TIMEOUT_MS);
    link.addEventListener('load', () => {
      clearTimeout(timer);
      resolve(link);
    }, { once: true });
    link.addEventListener('error', () => {
      clearTimeout(timer);
      stylePromises.delete(href);
      reject(new Error('SmallDocs stylesheet could not be loaded: ' + href));
    }, { once: true });
    document.head.appendChild(link);
  });

  stylePromises.set(href, promise);
  return promise;
}

let coreAssetsPromise = null;

export function ensureCoreAssets() {
  if (coreAssetsPromise) return coreAssetsPromise;
  coreAssetsPromise = Promise.all([
    loadStyle(sdkAsset('smalldocs.css'), 'smalldocs-sdk-styles'),
    loadStyle(sdkAsset('prose-reader.css'), 'smalldocs-sdk-prose-reader-styles'),
    loadScript(vendorAsset('sdocs-yaml.js'), () => window.SDocYaml),
    loadScript(vendorAsset('sdocs-styles.js'), () => window.SDocStyles),
    loadScript(vendorAsset('sdocs-slugify.js'), () => window.SDocSlugify),
    loadScript(vendorAsset('sdocs-prose-reader.js'), () => window.SDocProseReader),
  ]).then((values) => Object.freeze({
    yaml: values[2],
    styles: values[3],
    slugify: values[4],
    prose: values[5],
  })).catch((error) => {
    coreAssetsPromise = null;
    throw error;
  });
  return coreAssetsPromise;
}

export function loadedAssetUrls() {
  return {
    scripts: Array.from(scriptPromises.keys()),
    styles: Array.from(stylePromises.keys()),
  };
}
