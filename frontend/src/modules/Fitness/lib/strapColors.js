// Text-only compatibility helper; live cards use HeartIcon.
export { cssColorForStrap, hashColorForDevice, strapLabel } from '../../../../../shared/contracts/fitness/strapColors.mjs';

const COLOR_EMOJI = {
  red: '❤️', orange: '🧡', yellow: '💛', green: '💚', blue: '💙',
  purple: '💜', beige: '🤎', brown: '🤎', teal: '🩵', pink: '🩷',
  white: '🤍', watch: '🤍', black: '🖤', gray: '🩶', grey: '🩶'
};

const FALLBACK_EMOJI = '🧡';

const norm = (color) => (color == null ? null : String(color).trim().toLowerCase() || null);

export function heartEmojiForColor(color) {
  const key = norm(color);
  if (!key) return FALLBACK_EMOJI;
  return COLOR_EMOJI[key] || FALLBACK_EMOJI;
}
