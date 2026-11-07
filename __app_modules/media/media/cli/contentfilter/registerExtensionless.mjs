import { register } from 'node:module';

/** Make browser modules importable from the CLI (see extensionlessHooks.mjs). Call before importing them. */
export function registerExtensionless() {
  register('./extensionlessHooks.mjs', import.meta.url);
}
