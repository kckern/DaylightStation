/** Semantic outbound contract for the heterogeneous content catalog. */
export class IContentCatalogGateway {
  resolve() { throw new Error('resolve must be implemented'); }
  resolveSource() { throw new Error('resolveSource must be implemented'); }
  hasSource() { throw new Error('hasSource must be implemented'); }
  getItem() { throw new Error('getItem must be implemented'); }
  getList() { throw new Error('getList must be implemented'); }
  resolvePlayables() { throw new Error('resolvePlayables must be implemented'); }
  resolveLaunchables() { throw new Error('resolveLaunchables must be implemented'); }
  sourceNames() { throw new Error('sourceNames must be implemented'); }
  sourcesFor() { throw new Error('sourcesFor must be implemented'); }
  resolveQueryScope() { throw new Error('resolveQueryScope must be implemented'); }
  search() { throw new Error('search must be implemented'); }
  progressNamespace() { throw new Error('progressNamespace must be implemented'); }
  describeItem() { throw new Error('describeItem must be implemented'); }
}

export function assertContentCatalogGateway(catalog) {
  const required = [
    'resolve', 'resolveSource', 'hasSource', 'getItem', 'getList',
    'resolvePlayables', 'resolveLaunchables', 'sourceNames', 'sourcesFor',
    'resolveQueryScope', 'search', 'progressNamespace', 'describeItem',
  ];
  for (const method of required) {
    if (typeof catalog?.[method] !== 'function') {
      throw new Error(`Content catalog gateway requires ${method}()`);
    }
  }
  return catalog;
}
