// Custom vitest environment that loads happy-dom from frontend/node_modules
// This allows tests in tests/isolated/ to use React testing libraries
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, realpathSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const worktreeRoot = path.resolve(__dirname, '../..');
// In worktrees, frontend/node_modules may not exist — fall back to the main repo.
// Worktrees can live INSIDE the main repo (.claude/worktrees/<name>) or as a SIBLING
// checkout. Cover both by probing candidate locations. The worktree root's
// `node_modules` is symlinked to the main checkout, so its realpath yields the main
// repo root regardless of layout.
const candidates = [
  path.resolve(__dirname, '../../frontend/node_modules'),
  path.resolve(__dirname, '../../../../../frontend/node_modules'),
];
try {
  const mainRepoRoot = path.dirname(realpathSync(path.join(worktreeRoot, 'node_modules')));
  candidates.push(path.join(mainRepoRoot, 'frontend/node_modules'));
} catch (_) { /* no node_modules symlink — rely on other candidates */ }
const frontendNodeModules = candidates.find((p) => existsSync(p)) || candidates[0];
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
  // SVG interfaces. Without these, jest-dom's element check has nothing to
  // compare against and any assertion on an SVG node dies with a bare
  // "Right-hand side of 'instanceof' is not an object" — which reads like a
  // broken test rather than a missing global. This codebase engraves notation,
  // so SVG elements are asserted on constantly.
  'SVGElement', 'SVGSVGElement', 'SVGGraphicsElement',
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
  'localStorage', 'sessionStorage',
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

    // ── No sockets to the fictional page origin ────────────────────────────
    //
    // happy-dom needs a page URL, and the default above is
    // `http://localhost:3000` — an address that EXISTS ONLY ON PAPER. But
    // happy-dom's `fetch` and `WebSocket` are real network clients, so any
    // component that fires a relative fetch or opens the app's `/ws` socket
    // (the logging transport's `wsService.connect()`, an autosave, a config
    // load) dials a REAL TCP connection to :3000. Nothing listens there, and
    // the failure is SLOW — DNS + two address families + connect timeouts —
    // so the rejection lands seconds later, after the owning test finished,
    // and vitest pins the unhandled rejection on whichever test happens to be
    // running in that worker. That was the full-sweep roulette: one or two
    // failures per sweep, a different victim each time (life-plan-authoring
    // one run, trigger.sideEffect the next), every one passing in isolation.
    //
    // ONLY the page origin is blocked. Suites that start a real local server
    // on an ephemeral port (laserPrinterAdapter's mock IPP printer, the school
    // router suites) keep working — those are never on :3000.
    //
    // fetch: reject IMMEDIATELY, so the rejection surfaces while the test
    // that caused it is still on the clock, with a message naming the cure.
    // WebSocket: an inert, forever-CONNECTING socket — no TCP, no error event.
    // An error event would kick WebSocketService into its reconnect ladder and
    // spray timers across unrelated tests; a socket stuck CONNECTING is the
    // one state its connect() treats as "already being handled".
    const pageOrigin = new URL(win.location.href).origin;
    const realFetch = win.fetch.bind(win);
    win.fetch = function fetch(resource, init) {
      const url = new URL(typeof resource === 'string' ? resource : resource?.url ?? String(resource), win.location.href);
      if (url.origin === pageOrigin) {
        return Promise.reject(new TypeError(
          `fetch(${url.pathname}) hit the fictional test-page origin (${pageOrigin}) — nothing listens there. `
          + 'Mock this call (vi.stubGlobal/component prop) in the test that triggered it.',
        ));
      }
      return realFetch(resource, init);
    };
    const RealWebSocket = win.WebSocket;
    const pageHost = new URL(win.location.href).host;
    win.WebSocket = class WebSocket extends EventTarget {
      static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
      constructor(url, protocols) {
        const parsed = new URL(String(url));
        if (parsed.host !== pageHost) return new RealWebSocket(url, protocols);
        super();
        this.url = String(url);
        this.readyState = 0; // CONNECTING, forever — no TCP behind it
        this.onopen = null; this.onclose = null; this.onerror = null; this.onmessage = null;
      }
      send() {}
      close() { this.readyState = 3; }
    };

    const { keys, originals } = populateGlobalFromWindow(global, win);

    return {
      async teardown(g) {
        // Drain one macrotask before tearing the window down. This window's
        // console IS the worker console (see setup above), and every write is
        // forwarded to the host over the worker's rpc channel (onUserConsoleLog).
        // A forward still in flight when the worker recycles dies as
        // "EnvironmentTeardownError: Closing rpc while onUserConsoleLog was
        // pending" — an intermittent, file-shifting sweep failure (exit 1 with
        // zero test failures). The await gives in-flight forwards a tick to
        // settle before the channel can tear down.
        await new Promise((resolve) => setTimeout(resolve, 0));
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
