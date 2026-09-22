import { failure } from '../../operationRegistry.mjs';

// Observed official bootstrap files, pinned until a reviewed inventory proves
// an update. Each must match the operation's privately bound static origin.
const BOOTSTRAP_STATIC = new Map([
  ['/_d/bifocal-9.1.0-ha/themes/listen/dewey/theme.js', 'script'],
  ['/_d/bifocal-9.1.0-ha/themes/listen/dewey/inc/str/en-US.js', 'script'],
  ['/_d/bifocal-9.1.0-ha/themes/listen/dewey/theme.css', 'stylesheet'],
]);

export function listenUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw failure('BROWSER_ORIGIN_REJECTED'); }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash
    || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*listen\.libbyapp\.com$/.test(url.hostname)) {
    throw failure('BROWSER_ORIGIN_REJECTED');
  }
  return url;
}

export function validateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).sort().join(',') !== 'message,operationId,webUrl'
    || typeof input.webUrl !== 'string' || input.webUrl.length > 4096
    || typeof input.message !== 'string' || !input.message || input.message.length > 32768
    || /[\x00-\x20\x7f#]/.test(input.message) || input.message.startsWith('?')
    || typeof input.operationId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(input.operationId)) {
    throw failure('BROWSER_INVALID_REQUEST');
  }
  if (listenUrl(input.webUrl).search) throw failure('BROWSER_ORIGIN_REJECTED');
  return { webUrl: input.webUrl, message: input.message, operationId: input.operationId };
}

function staticRequestUrl(request) {
  if (request.method !== 'GET' || request.isNavigation || request.isMainFrame === false) return null;
  let url;
  try { url = new URL(request.url); } catch { return null; }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash
    || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+libbyapp\.com$/.test(url.hostname)
    || BOOTSTRAP_STATIC.get(url.pathname) !== request.resourceType) return null;
  return url;
}

export function allowsRequest(request, webUrl, { staticOrigin } = {}) {
  let url;
  let shell;
  try { shell = listenUrl(webUrl); } catch { return false; }
  if (['script', 'stylesheet'].includes(request.resourceType)) {
    url = staticRequestUrl(request);
    return Boolean(url && url.origin === (staticOrigin ?? shell.origin));
  }
  try { url = listenUrl(request.url); } catch { return false; }
  if (url.origin !== shell.origin || request.method !== 'GET') return false;
  let path;
  try { path = decodeURIComponent(url.pathname).toLowerCase(); } catch { return false; }
  if (/(?:activity|analytics|telemetry|report|error|tracking|metrics)/.test(path)) return false;
  if (/\.(?:mp3|mp4|m4a|m4b|aac|ogg|opus|wav|m3u8|mpd)(?:$|\/)/.test(path)) return false;
  if (request.isNavigation) return request.isMainFrame && url.pathname === shell.pathname && request.resourceType === 'document';
  return ['fetch', 'xhr'].includes(request.resourceType) && url.pathname === '/_d/possession';
}

function allowsMediaRequest(request, webUrl) {
  if (!request.isMainFrame || request.isNavigation || request.method !== 'GET' || request.resourceType !== 'media') return false;
  let url;
  let shell;
  try { url = new URL(request.url); shell = listenUrl(webUrl); } catch { return false; }
  if (url.username || url.password || url.hash || url.port || url.protocol !== 'https:') return false;
  return url.origin === shell.origin || url.hostname === 'audioclips.cdn.overdrive.com';
}

// Runs before provider script in every page/frame realm. Dedicated and shared
// workers and audio-worklet modules create targets that are not covered by
// page-scoped CDP Fetch, so their creation/loading entry points must be made
// unavailable before page code can retain them.
export function installPageTargetGuards() {
  const BlockedWorker = function BlockedWorker() {
    throw new TypeError('Worker targets are disabled');
  };
  const blockModule = function blockModule() {
    throw new TypeError('Worklet module loading is disabled');
  };
  const blockedWorklet = {};
  Object.defineProperty(blockedWorklet, 'addModule', {
    value: blockModule, writable: false, configurable: false, enumerable: true,
  });
  Object.freeze(blockedWorklet);
  const sealNativeLoader = loader => {
    if (!loader || (typeof loader !== 'object' && typeof loader !== 'function')) return;
    let owner = loader;
    while (owner && !Object.prototype.hasOwnProperty.call(owner, 'addModule')) owner = Object.getPrototypeOf(owner);
    const descriptor = owner && Object.getOwnPropertyDescriptor(owner, 'addModule');
    if (descriptor?.configurable) Object.defineProperty(owner, 'addModule', {
      value: blockModule, writable: false, configurable: false, enumerable: descriptor.enumerable,
    });
    if (!Object.prototype.hasOwnProperty.call(loader, 'addModule')) Object.defineProperty(loader, 'addModule', {
      value: blockModule, writable: false, configurable: false, enumerable: true,
    });
  };
  const sealSurface = (container, name) => {
    if (!container || !(name in container)) return;
    let nativeLoader;
    try { nativeLoader = container[name]; } catch { /* Replace the surface below. */ }
    sealNativeLoader(nativeLoader);
    let owner = container;
    while (owner && !Object.prototype.hasOwnProperty.call(owner, name)) owner = Object.getPrototypeOf(owner);
    const descriptor = owner && Object.getOwnPropertyDescriptor(owner, name);
    if (owner && descriptor?.configurable) Object.defineProperty(owner, name, {
      get() { return blockedWorklet; }, configurable: false, enumerable: descriptor.enumerable,
    });
    if (owner !== container) Object.defineProperty(container, name, {
      get() { return blockedWorklet; }, configurable: false, enumerable: true,
    });
  };
  for (const name of ['Worker', 'SharedWorker']) {
    Object.defineProperty(globalThis, name, {
      value: BlockedWorker, writable: false, configurable: false, enumerable: false,
    });
  }
  if (typeof BaseAudioContext === 'function') {
    Object.defineProperty(BaseAudioContext.prototype, 'audioWorklet', {
      get() { return blockedWorklet; },
      configurable: false, enumerable: true,
    });
  }
  if (typeof CSS === 'object' && CSS) {
    for (const name of ['paintWorklet', 'layoutWorklet', 'animationWorklet']) sealSurface(CSS, name);
  }
  for (const name of ['paintWorklet', 'layoutWorklet', 'animationWorklet']) sealSurface(globalThis, name);
}

export async function installPolicy(context, page, webUrl) {
  // The official page requests these pinned bundles on a distinct origin.
  // Bind it once for this operation only; never reuse, return, or log it.
  let staticOrigin;
  let phase = 'bootstrap';
  await context.addInitScript(installPageTargetGuards);
  context.on('page', extraPage => { if (extraPage !== page) return extraPage.close().catch(() => {}); });
  page.on('popup', popup => popup.close().catch(() => {}));
  page.on('download', download => download.cancel().catch(() => {}));
  await context.routeWebSocket('**/*', socket => socket.close());
  await context.route('**/*', async route => {
    const request = route.request();
    let isMainFrame = false;
    try { isMainFrame = request.frame() === page.mainFrame(); } catch { /* Worker requests are not navigation. */ }
    const descriptor = { url: request.url(), method: request.method(), resourceType: request.resourceType(),
      isNavigation: request.isNavigationRequest(), isMainFrame };
    if (phase !== 'bootstrap') {
      if (phase === 'media' && allowsMediaRequest(descriptor, webUrl)) return route.continue();
      return route.abort('blockedbyclient');
    }
    const approvedStatic = staticRequestUrl(descriptor);
    if (approvedStatic) staticOrigin ??= approvedStatic.origin;
    if (!allowsRequest(descriptor, webUrl, { staticOrigin })) return route.abort('blockedbyclient');
    // Playwright routes only the first URL of a redirect chain. Fetch without
    // following redirects and fail closed before forwarding to the page.
    let response;
    try {
      response = await route.fetch({ maxRedirects: 0, timeout: 20_000 });
      if (response.status() >= 300 && response.status() < 400) await route.abort('blockedbyclient');
      else await route.fulfill({ response });
    } catch { await route.abort('failed').catch(() => {}); }
    finally { await response?.dispose().catch(() => {}); }
  });
  return Object.freeze({
    beginMediaPhase() {
      if (phase !== 'bootstrap') throw failure('BROWSER_FAILED');
      phase = 'media';
    },
    endMediaPhase() { phase = 'closed'; },
  });
}
