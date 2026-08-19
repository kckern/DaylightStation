// useCourseTabPolicy.js — resolve the effective course policy for a lecture by
// folding the owning TAB's flags (videos.collections) into the per-USER flags
// (videos.user_policies).
//
// Cost control: a tab that lists its members as `shows` answers from config
// alone, so the common case costs nothing. Only a tab defined by a Plex
// `collection` needs its item list fetched, and only when the id in hand hasn't
// already been decided — Plex requests serialize, so an unconditional fetch here
// would put a round trip in front of every lecture open for no reason.
import { useEffect, useMemo, useState } from 'react';
import { DaylightAPI } from '../../../../../lib/api.mjs';
import {
  resolveTabPolicies,
  tabsCarryingPolicy,
  tabOwnsCourse,
  resolveEffectivePolicy,
} from './courseTabPolicy.js';

const ratingKeyOf = (c) => String(c || '').replace(/^plex:/, '');

export function useCourseTabPolicy(videos, courseId, userPolicy) {
  const tabs = useMemo(() => resolveTabPolicies(videos), [videos]);
  const policyTabs = useMemo(() => tabsCarryingPolicy(tabs), [tabs]);
  const [items, setItems] = useState({});

  // Which collections must be fetched before this course's membership is known?
  // Empty when config alone already settles it (every policy tab returned a
  // definite true/false), which is the case for shows-defined tabs.
  const pending = useMemo(() => {
    if (!courseId) return [];
    const undecided = policyTabs.filter((t) => tabOwnsCourse(t, courseId, items) === null);
    return [...new Set(undecided.flatMap((t) => t.collections))];
  }, [policyTabs, courseId, items]);

  const pendingKey = pending.join(',');
  useEffect(() => {
    if (!pendingKey) return undefined;
    let cancelled = false;
    Promise.all(
      pendingKey.split(',').map((c) =>
        DaylightAPI(`api/v1/list/plex/${ratingKeyOf(c)}`)
          .then((r) => [c, (r?.items ?? []).map((it) => it?.id).filter(Boolean)])
          // A failed lookup resolves to "no members", i.e. not a member, i.e.
          // no speed control. Failing closed beats failing open here.
          .catch(() => [c, []]),
      ),
    ).then((pairs) => {
      if (!cancelled) setItems((m) => ({ ...m, ...Object.fromEntries(pairs) }));
    });
    return () => { cancelled = true; };
  }, [pendingKey]);

  return useMemo(
    () => resolveEffectivePolicy(userPolicy, tabs, courseId, items),
    [userPolicy, tabs, courseId, items],
  );
}

export default useCourseTabPolicy;
