// Composition wiring for the /vendor router (media/vendor, installed by npm run install:assets).
import { join } from 'node:path';
import { createVendorRouter } from '#api/v1/routers/vendor.mjs';

/** Directory that holds installed third-party assets, under the media dir. */
export const vendorDirFor = (mediaDir) => join(mediaDir, 'vendor');

export function createVendorApiRouter({ mediaDir, logger = console }) {
  return createVendorRouter({ vendorDir: vendorDirFor(mediaDir), logger });
}
