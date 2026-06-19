import { IStreamResolver } from '#apps/content/ports/IStreamResolver.mjs';
import { StreamResult } from '#domains/content/value-objects/StreamResult.mjs';

/** Terminal resolver: renders any web page in an iframe. */
export class IframeStreamResolver extends IStreamResolver {
  get strategy() { return 'iframe'; }
  async resolve(url, profile) {
    if (!/^https?:\/\//i.test(url)) return null;
    return new StreamResult({ format: 'webview', mediaUrl: url, title: profile?.name ?? null });
  }
}
