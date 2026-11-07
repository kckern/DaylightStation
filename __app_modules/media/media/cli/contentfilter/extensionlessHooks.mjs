/**
 * Node loader hook: lets the CLI import browser modules (the content-filter resolver) whose
 * relative imports omit the extension (Vite resolves those; plain Node does not). Retries a
 * failed relative specifier with `.js`, then `/index.js`. Registered by `registerExtensionless()`.
 */
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (err?.code !== 'ERR_MODULE_NOT_FOUND' || !/^\.\.?\//.test(specifier) || /\.[a-z]+$/i.test(specifier)) throw err;
    try { return await next(`${specifier}.js`, context); } catch { return next(`${specifier}/index.js`, context); }
  }
}
