/**
 * Share policy — household `share/config.yml`, and the pure rules of a share.
 *
 *   default_target: livingroom-tv          # where a share plays when the phone names none
 *   targets:                               # every screen a share may be sent to
 *     livingroom-tv: { label: Living room TV }
 *     office-tv: { label: Office }
 *
 * A target id is a `devices.yml` screen id. With no file, the living-room TV
 * is the one target.
 *
 * Reference: __docs/reference/core/share.md
 */
export const TARGET_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const SHARE_DEFAULTS = Object.freeze({ defaultTarget: 'livingroom-tv' });

/** @returns {{ defaultTarget: string, targets: Array<{ id: string, label: string }> }} */
export function sharePolicy(raw) {
  const cfg = raw && typeof raw === 'object' ? raw : {};
  const targets = [];
  const seen = new Set();
  const entries = cfg.targets && typeof cfg.targets === 'object' ? Object.entries(cfg.targets) : [];
  for (const [id, value] of entries) {
    if (!TARGET_ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    const label = typeof value?.label === 'string' && value.label.trim() ? value.label.trim().slice(0, 40) : id;
    targets.push({ id, label });
  }
  let defaultTarget = typeof cfg.default_target === 'string' && TARGET_ID.test(cfg.default_target)
    ? cfg.default_target : null;
  if (!targets.length) targets.push({ id: defaultTarget || SHARE_DEFAULTS.defaultTarget, label: 'Living room TV' });
  if (!defaultTarget || !targets.some((t) => t.id === defaultTarget)) defaultTarget = targets[0].id;
  return { defaultTarget, targets };
}

/**
 * The URL a share is about: the first http(s) URL in the shared text (apps put
 * a title or a sentence around it). null when there is none.
 */
export function sharedUrlIn(text) {
  const match = /https?:\/\/[^\s<>"']+/i.exec(String(text ?? ''));
  if (!match) return null;
  const url = match[0].replace(/[),.;!?\]]+$/, '');
  try { return new URL(url).toString(); } catch { return null; }
}

/** The intake path of one target: the default target also answers at /text. */
export function shareIntakePaths(policy, base = '/api/v1/share') {
  return ['/text', ...policy.targets.map((t) => `/to/${t.id}/text`)].map((p) => `${base}${p}`);
}
