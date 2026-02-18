/**
 * Feed scroll diagnostic logger.
 *
 * Enable in browser console:  localStorage.setItem('feedDebug', '1')
 * Disable:                    localStorage.removeItem('feedDebug')
 * Filter specific categories: localStorage.setItem('feedDebug', 'scroll,image')
 *
 * Categories: scroll, image, player, dismiss, detail, nav
 */

const CATEGORIES = ['scroll', 'image', 'player', 'dismiss', 'detail', 'nav', 'assembly', 'masonry'];

function getFilter() {
  try {
    const v = localStorage.getItem('feedDebug');
    if (!v) return null; // disabled
    if (v === '1' || v === 'true' || v === '*') return CATEGORIES;
    return v.split(',').map(s => s.trim()).filter(Boolean);
  } catch { return null; }
}

function log(category, ...args) {
  const filter = getFilter();
  if (!filter || !filter.includes(category)) return;
  const ts = new Date().toISOString().slice(11, 23);
  console.debug(`%c[Feed:${category}]%c ${ts}`, 'color:#fab005;font-weight:bold', 'color:#868e96', ...args);
}

export const feedLog = {
  scroll:   (...args) => log('scroll', ...args),
  image:    (...args) => log('image', ...args),
  player:   (...args) => log('player', ...args),
  dismiss:  (...args) => log('dismiss', ...args),
  detail:   (...args) => log('detail', ...args),
  nav:      (...args) => log('nav', ...args),
  assembly: (...args) => log('assembly', ...args),
  masonry:  (...args) => log('masonry', ...args),
};
