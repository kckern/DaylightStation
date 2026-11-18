import moment from 'moment-timezone';
import { keyOf } from '../workModel.mjs';
import { workHash } from '../workState.mjs';
const instant = (value, now) => Number.isFinite(value) && value >= 0 && value <= now;
const same = (a, b) => a && b && keyOf(a) === keyOf(b);
const DAY = 86400000;
export function insideReviewWindow(policy, asOf) {
  const local = moment.tz(asOf, policy.timezone),
    time = local.format('HH:mm');
  return (policy.attention.reviewWindows ?? []).some(w => w.start < w.end && w.days.includes(local.isoWeekday()) && time >= w.start && time < w.end);
}
/** Source dates never become user relevance merely because a collector refreshed. */
export function selectOpportunities({
  context,
  relevance = context.relevance ?? {},
  history = {},
  policy,
  asOf,
  explicitRequest = false
}) {
  const eligible = [],
    excluded = [],
    drop = (key, reason) => excluded.push({
      key,
      reason
    });
  if (!policy?.enabled || !Number.isFinite(asOf) || !moment.tz.zone(policy.timezone) || !explicitRequest && !policy.proactive) return {
    eligible,
    excluded: [{
      key: 'policy',
      reason: 'proactive_disabled'
    }]
  };
  let housekeepingQuiet = false;
  const day = moment.tz(asOf, policy.timezone).format('YYYY-MM-DD'),
    attention = policy.attention,
    records = history.records ?? [];
  if (!explicitRequest) {
    if ((history.unansweredInvitations ?? []).some(r => r.expiresAt > asOf && !r.response) || records.some(r => ['housekeeping', 'review'].includes(r.channel) && r.expiresAt > asOf && !r.response && ['prepared', 'quarantined', 'delivered'].includes(r.status))) return {
      eligible,
      excluded: [{
        key: 'attention',
        reason: 'unanswered_invitation'
      }]
    };
    const delivered = records.filter(r => (r.channel === 'housekeeping' || r.flowType === 'housekeeping') && r.status === 'delivered' && instant(r.deliveredAt, asOf)).sort((a, b) => b.deliveredAt - a.deliveredAt);
    const ignored = [];
    for (const row of delivered) {
      if (row.response) break;
      if (asOf - row.deliveredAt >= attention.ignoredOfferHours * 3600000) ignored.push(row);
    }
    if (ignored.length >= attention.ignoredOffersBeforeQuiet) {
      const quietUntil = moment.tz(ignored[0].deliveredAt + attention.ignoredOfferHours * 3600000, policy.timezone).add(attention.quietDays, 'days').valueOf();
      if (asOf < quietUntil) housekeepingQuiet = true;
    }
  }
  const candidates = [];
  for (const item of context.items ?? []) {
    const key = keyOf(item.ref),
      r = relevance[key] ?? {
        state: 'unconfirmed'
      },
      domains = Object.entries(policy.domains).filter(([, d]) => {
        const p = policy.providers[d.provider];
        return p?.type === item.ref.provider && p.accountId === item.ref.accountId && p.operations?.includes('read') && d.containerId === item.containerRef?.id && (!d.assigneeIds || d.assigneeIds.some(id => item.assigneeIds.includes(id)));
      });
    if (domains.length !== 1) {
      drop(key, 'ambiguous_or_unconfigured_domain');
      continue;
    }
    const [domainId] = domains[0],
      due = instant(r.reviewAt, asOf),
      paused = ['paused', 'retired'].includes(r.state) || item.status.category === 'paused';
    if (!explicitRequest && (r.snoozedUntil > asOf || paused && !due)) {
      drop(key, r.snoozedUntil > asOf ? 'snoozed' : 'paused_or_retired');
      continue;
    }
    const linked = (context.links ?? []).filter(l => same(l.workRef, item.ref));
    if (!explicitRequest && linked.some(l => context.knowledgeEligibility?.[l.kbObjectId]?.allowed !== true)) {
      drop(key, 'knowledge_policy');
      continue;
    }
    const grounded = (context.groundedReferences ?? []).filter(g => g.verified === true && same(g.ref, item.ref) && instant(g.at, asOf) && asOf - g.at < attention.staleRelevanceDays * DAY);
    const confirmed = r.state === 'active' && instant(r.confirmedAt, asOf) && asOf - r.confirmedAt < attention.staleRelevanceDays * DAY;
    const recentAt = Math.max(confirmed ? r.confirmedAt : 0, ...grounded.map(g => g.at), 0),
      meaningful = [r.confirmedAt, item.modifiedAt, ...grounded.map(g => g.at)].filter(t => instant(t, asOf));
    const newest = meaningful.length ? Math.max(...meaningful) : null;
    let flowType, reason, eligibleAt;
    if (explicitRequest) {
      flowType = paused ? 'reactivate' : 'housekeeping';
      reason = 'user_requested_review';
      eligibleAt = asOf;
    } else if (context.coverage?.complete !== true) {
      if (!recentAt && !due) {
        drop(key, 'stale_source_without_relevance');
        continue;
      }
      flowType = 'coverage_repair';
      reason = 'stale_or_partial_source';
      eligibleAt = recentAt || r.reviewAt;
    } else if (paused && due) {
      flowType = 'reactivate';
      reason = 'requested_review_date';
      eligibleAt = r.reviewAt;
    } else if (recentAt) {
      flowType = item.status.category === 'done' ? 'wrap_up' : 'reconcile';
      reason = grounded.length ? 'recent_grounded_reference' : 'confirmed_active';
      eligibleAt = recentAt;
    } else {
      if (housekeepingQuiet) {
        drop(key, 'ignored_offers_quiet');
        continue;
      }
      if (!attention.housekeepingDomains.includes(domainId) || !insideReviewWindow(policy, asOf)) {
        drop(key, 'housekeeping_not_opted_in_or_outside_window');
        continue;
      }
      if (newest !== null && asOf - newest < attention.staleRelevanceDays * DAY) {
        drop(key, 'not_stale');
        continue;
      }
      flowType = 'housekeeping';
      reason = newest === null ? 'unknown_source_dates' : 'stale_relevance';
      eligibleAt = newest === null ? asOf : newest + attention.staleRelevanceDays * DAY;
    }
    const relevanceVersion = workHash(r),
      id = 'offer.' + workHash([policy.username, day, flowType, item.ref, item.version, policy.revision, relevanceVersion]);
    const offer = {
      id,
      username: policy.username,
      flowType,
      ref: structuredClone(item.ref),
      kbObjectId: null,
      domainId,
      evidenceRefs: grounded.slice().sort((a, b) => b.at - a.at).slice(0, 5).map(g => g.evidenceRef).filter(Boolean),
      reason,
      eligibleAt,
      expiresAt: asOf + attention.offerExpiryHours * 3600000,
      questionUnits: 1,
      requiresConfirmation: true,
      expectedVersion: item.version,
      policyRevision: policy.revision
    };
    candidates.push({
      offer,
      recentAt,
      lastOfferedAt: r.lastOfferedAt ?? 0
    });
  }
  const review = context.pendingReview;
  if (review?.available === true && (explicitRequest || review.due === true) && Array.isArray(review.ids) && review.ids.length && typeof review.revision === 'string') {
    const ids = review.ids.slice(0, 5);
    const id = 'offer.' + workHash([policy.username, day, 'knowledge_review', ids, review.revision, policy.revision]);
    candidates.push({
      offer: {
        id,
        username: policy.username,
        flowType: 'knowledge_review',
        ref: null,
        kbObjectId: null,
        domainId: 'knowledge',
        evidenceRefs: ids,
        reason: 'pending_owner_reviews',
        eligibleAt: asOf,
        expiresAt: asOf + attention.offerExpiryHours * 3600000,
        questionUnits: 1,
        requiresConfirmation: true,
        expectedVersion: review.revision,
        policyRevision: policy.revision
      },
      recentAt: asOf,
      lastOfferedAt: 0
    });
  }
  candidates.sort((a, b) => b.recentAt - a.recentAt || a.lastOfferedAt - b.lastOfferedAt || a.offer.id.localeCompare(b.offer.id));
  return {
    eligible: candidates.map(c => c.offer),
    excluded
  };
}
