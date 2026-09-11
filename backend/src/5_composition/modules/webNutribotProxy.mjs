/** Health is composed before Nutribot. Keep its deferred public methods together
 * so meal suggestions and capture use the same eventual adapter instance. */
export function createWebNutribotProxy() {
  const proxy = { _delegate: null };
  for (const method of ['process', 'processCallback', 'listPendingByDate', 'suggestMealGroups', 'reviseEntry']) {
    proxy[method] = (...args) => {
      if (typeof proxy._delegate?.[method] !== 'function') {
        return Promise.reject(new Error('webNutribotAdapter not yet initialized'));
      }
      return proxy._delegate[method](...args);
    };
  }
  return proxy;
}
