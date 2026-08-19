// pageLifecycle.js — log when the PAGE (not our code) is suspended or resumed.
//
// Kiosk WebViews pause media, throttle timers and stop presenting frames on
// signals that leave no trace in application logs. When a video pauses itself
// and the app looks healthy, the only way to tell "the OS backgrounded us" from
// "something else did it" is to have recorded the document's own transitions.
//
// Attach once per page; repeated calls are no-ops.

import getLogger from './Logger.js';

let attached = false;

/**
 * Start logging document lifecycle transitions.
 *
 * @param {object} [opts]
 * @param {string} [opts.app] - subsystem tag for the child logger
 * @param {Window} [opts.win] - injected for testing
 * @returns {() => void} detach
 */
export function attachPageLifecycleLogging({ app = 'kiosk', win = (typeof window !== 'undefined' ? window : null) } = {}) {
  if (!win || attached) return () => {};
  attached = true;
  const doc = win.document;
  const log = getLogger().child({ component: 'page-lifecycle', app });
  const startedTs = Date.now();

  // Every handler reports the same flat shape so one query compares them all.
  const state = (event, extra = {}) => ({
    event,
    visibilityState: doc?.visibilityState ?? null,
    hidden: doc?.hidden ?? null,
    uptimeSec: Math.round((Date.now() - startedTs) / 1000),
    ...extra,
  });

  const onVisibility = () => {
    // info, not debug: this is low-frequency and is the single most useful
    // signal for attributing an unexplained media pause.
    log.info('page.visibility', state('visibilitychange'));
  };
  const onFreeze = () => log.warn('page.freeze', state('freeze'));
  const onResume = () => log.info('page.resume', state('resume'));
  const onPageHide = (e) => log.warn('page.hide', state('pagehide', { persisted: !!e?.persisted }));
  const onPageShow = (e) => log.info('page.show', state('pageshow', { persisted: !!e?.persisted }));
  // A blur/focus pair without a visibility change is the fingerprint of another
  // app or a system dialog taking foreground without backgrounding the page —
  // the case that also steals audio focus and pauses media.
  const onBlur = () => log.info('page.blur', state('blur'));
  const onFocus = () => log.info('page.focus', state('focus'));

  const bindings = [
    [doc, 'visibilitychange', onVisibility],
    [doc, 'freeze', onFreeze],
    [doc, 'resume', onResume],
    [win, 'pagehide', onPageHide],
    [win, 'pageshow', onPageShow],
    [win, 'blur', onBlur],
    [win, 'focus', onFocus],
  ];
  for (const [target, type, fn] of bindings) target?.addEventListener?.(type, fn);

  return () => {
    for (const [target, type, fn] of bindings) target?.removeEventListener?.(type, fn);
    attached = false;
  };
}

/** Test seam: forget that we attached. */
export function __resetPageLifecycleForTests() { attached = false; }

export default attachPageLifecycleLogging;
