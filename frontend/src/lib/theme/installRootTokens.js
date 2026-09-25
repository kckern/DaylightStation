import { dsRootCss } from './tokens.mjs';

/**
 * Put the base token contract on :root for every page, from tokens.mjs.
 *
 * Inserted as the FIRST stylesheet in <head>, never as inline style on <html>:
 * an app sheet that sets its own :root values (Admin's palette) is an equal-
 * specificity rule that comes later, so it still wins on that app's pages.
 * Inline style would beat every sheet.
 */
export function installRootTokens(doc = document) {
  if (doc.getElementById('ds-root-tokens')) return;
  const style = doc.createElement('style');
  style.id = 'ds-root-tokens';
  style.textContent = dsRootCss();
  doc.head.prepend(style);
}

export default installRootTokens;
