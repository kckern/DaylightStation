export class IEinkDataSourceGateway {
  resolve() { throw new Error('resolve must be implemented'); }
}

export function isEinkDataSourceGateway(value) {
  return value != null && typeof value.resolve === 'function';
}
