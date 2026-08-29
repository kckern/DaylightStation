export class IFeedConfigRepository {
  getHeadlineConfig() { throw new Error('getHeadlineConfig must be implemented'); }
  getScrollConfig() { throw new Error('getScrollConfig must be implemented'); }
}

export function isFeedConfigRepository(value) {
  return value != null
    && typeof value.getHeadlineConfig === 'function'
    && typeof value.getScrollConfig === 'function';
}
