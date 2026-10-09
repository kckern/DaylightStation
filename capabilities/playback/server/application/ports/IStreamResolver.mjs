// What StreamAdapter needs from any resolution strategy. Vendor-neutral.
/**
 * @typedef {import('../../../2_domains/content/value-objects/StreamResult.mjs').StreamResult} StreamResult
 * @interface IStreamResolver
 */
export class IStreamResolver {
  /** @returns {string} strategy key matching StreamProfile.strategy ('scrape'|'ytdlp'|'iframe') */
  get strategy() { throw new Error('IStreamResolver.strategy must be implemented'); }

  /**
   * @param {string} url
   * @param {import('../../../2_domains/content/value-objects/StreamProfile.mjs').StreamProfile} [profile]
   * @returns {Promise<StreamResult|null>} null = declined
   */
  async resolve(url, profile) { throw new Error('IStreamResolver.resolve must be implemented'); }
}

export function isStreamResolver(o) {
  return o && typeof o.resolve === 'function' && typeof o.strategy === 'string';
}
