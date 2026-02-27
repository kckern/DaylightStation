// Custom vitest environment that loads happy-dom from frontend/node_modules
// This allows tests in tests/isolated/ to use React testing libraries
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendNodeModules = path.resolve(__dirname, '../../frontend/node_modules');
const happyDomPath = path.join(frontendNodeModules, 'happy-dom', 'lib', 'index.js');

const { Window, GlobalWindow } = await import(happyDomPath);

// Copied from vitest/dist/chunks/index.CyBMJtT7.js
// These are the living DOM interfaces + other keys that should be synced to global
const LIVING_KEYS = [
  'AbortController', 'AbortSignal', 'AbstractRange', 'Attr', 'CDATASection',
  'CharacterData', 'Comment', 'CustomEvent', 'Document', 'DocumentFragment',
  'DocumentType', 'Element', 'Event', 'EventTarget', 'File', 'FormData',
  'HTMLAnchorElement', 'HTMLBodyElement', 'HTMLButtonElement', 'HTMLCanvasElement',
  'HTMLDivElement', 'HTMLElement', 'HTMLFormElement', 'HTMLHeadElement',
  'HTMLHeadingElement', 'HTMLHtmlElement', 'HTMLIFrameElement', 'HTMLImageElement',
  'HTMLInputElement', 'HTMLLabelElement', 'HTMLLinkElement', 'HTMLLIElement',
  'HTMLMediaElement', 'HTMLMetaElement', 'HTMLOListElement', 'HTMLOptGroupElement',
  'HTMLOptionElement', 'HTMLParagraphElement', 'HTMLPreElement', 'HTMLScriptElement',
  'HTMLSelectElement', 'HTMLSourceElement', 'HTMLSpanElement', 'HTMLStyleElement',
  'HTMLTableCellElement', 'HTMLTableElement', 'HTMLTableRowElement',
  'HTMLTableSectionElement', 'HTMLTextAreaElement', 'HTMLTitleElement',
  'HTMLUListElement', 'HTMLVideoElement', 'HashChangeEvent', 'History',
  'KeyboardEvent', 'Location', 'MessageChannel', 'MessageEvent', 'MessagePort',
  'MouseEvent', 'MutationObserver', 'MutationRecord', 'NamedNodeMap', 'Node',
  'NodeFilter', 'NodeIterator', 'NodeList', 'Notification', 'Performance',
  'PerformanceMark', 'PerformanceMeasure', 'PerformanceObserver',
  'PerformanceObserverEntryList', 'PopStateEvent', 'ProcessingInstruction',
  'ProgressEvent', 'Range', 'Request', 'Response', 'ShadowRoot', 'StaticRange',
  'Storage', 'StorageEvent', 'StyleSheet', 'Text', 'TextDecoder', 'TextEncoder',
  'Touch', 'TouchEvent', 'TouchList', 'TreeWalker', 'UIEvent', 'URL', 'URLSearchParams',
  'WebSocket', 'Window', 'XMLDocument', 'XMLHttpRequest',
  'XMLHttpRequestEventTarget', 'XMLSerializer',
];
const OTHER_KEYS = [
  'EventSource', 'CSS', 'Headers', 'IntersectionObserver', 'ResizeObserver',
  'Blob', 'DOMException', 'DOMParser', 'File', 'FileList', 'FileReader',
  'Image', 'Audio', 'Option',
  'addEventListener', 'removeEventListener', 'dispatchEvent',
  'requestAnimationFrame', 'cancelAnimationFrame',
  'requestIdleCallback', 'cancelIdleCallback',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'setImmediate', 'clearImmediate', 'queueMicrotask',
  'atob', 'btoa',
  'fetch', 'navigator', 'location', 'history', 'screen',
  'getComputedStyle', 'getSelection', 'scrollTo', 'scrollBy',
  'alert', 'confirm', 'prompt', 'open', 'close', 'postMessage',
  'innerWidth', 'innerHeight', 'outerWidth', 'outerHeight',
  'devicePixelRatio',
  'crypto', 'performance',
  'customElements',
  'matchMedia',
  'document',
];
const ALL_KEYS = [...new Set([...LIVING_KEYS, ...OTHER_KEYS])];
const SKIP_KEYS = new Set(['window', 'self', 'top', 'parent']);

function populateGlobalFromWindow(global, win) {
  const originals = new Map();
  const keys = new Set();

  for (const key of ALL_KEYS) {
    if (SKIP_KEYS.has(key)) continue;
    try {
      if (key in win) {
        if (key in global) {
          originals.set(key, global[key]);
        } else {
          keys.add(key);
        }
        const winKey = key;
        Object.defineProperty(global, key, {
          get() { return win[winKey]; },
          set(v) { win[winKey] = v; },
          configurable: true,
          enumerable: true,
        });
      }
    } catch {}
  }

  global.window = global;
  global.self = global;
  global.top = global;
  global.parent = global;

  if (global.document && global.document.defaultView) {
    try {
      Object.defineProperty(global.document, 'defaultView', {
        get: () => global,
        enumerable: true,
        configurable: true,
      });
    } catch {}
  }

  return { keys, originals };
}

export default {
  name: 'frontend-dom',
  viteEnvironment: 'ssr',
  async setup(global, { happyDOM = {} } = {}) {
    const win = new (GlobalWindow || Window)({
      ...happyDOM,
      console: console && globalThis.console ? globalThis.console : undefined,
      url: happyDOM.url || 'http://localhost:3000',
      settings: {
        ...(happyDOM.settings || {}),
        disableErrorCapturing: true,
      },
    });

    const { keys, originals } = populateGlobalFromWindow(global, win);

    return {
      teardown(g) {
        keys.forEach(key => {
          try { delete g[key]; } catch {}
        });
        originals.forEach((v, k) => {
          try { g[k] = v; } catch {}
        });
        try { win.happyDOM?.abort?.(); } catch {}
        try { win.close?.(); } catch {}
      },
    };
  },
};
