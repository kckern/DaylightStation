/** Bind an HTTP proxy route to one configured content provider. */
export function createContentProxyHandler({ proxyService, provider }) {
  if (!proxyService?.proxy) throw new Error('createContentProxyHandler requires proxyService');
  if (!provider) throw new Error('createContentProxyHandler requires provider');
  return async function contentProxyHandler(req, res) {
    await proxyService.proxy(provider, req, res);
  };
}

export default createContentProxyHandler;
