import { keyOf } from './workModel.mjs';
const normalized = value => String(value ?? '').normalize('NFC').trim().toLowerCase();
export function affirmativeCompletion(statement, title) {
  const target = String(title ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return typeof statement === 'string' && new RegExp('^I (?:have |just )?(?:finished|completed) ' + target + '[.!]?$', 'i').test(statement.trim());
}
export function checkedInProgress(statement, title) {
  const target = String(title ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return typeof statement === 'string' && new RegExp('^I (?:have |just )?checked (?:in ' + target + '|' + target + ' in)[.!]?$', 'i').test(statement.trim());
}
export function matchWorkIntent({
  intent,
  items,
  links,
  policy
}) {
  const empty = {
    matches: [],
    mode: 'none'
  };
  if (!policy?.enabled || !intent?.verified || !intent.authored || !intent.current || typeof intent.quote !== 'string' || !intent.statement?.includes(intent.quote)) return empty;
  const remainder = intent.statement.toLowerCase().split(String(intent.title ?? '').toLowerCase()).join(' ');
  if (intent.operation === 'complete' && (/["“”]/.test(remainder) || /\b(?:not|never|might|maybe|will|tomorrow|planning|hoping|said|says)\b|\b(?:haven|hasn|hadn|didn)['’]t\b/.test(remainder))) return empty;
  const domains = Object.entries(policy.domains).filter(([id]) => intent.domainId == null || id === intent.domainId);
  const matches = items.filter(item => normalized(item.title) === normalized(intent.title) && domains.some(([, d]) => {
    const p = policy.providers[d.provider];
    return p?.type === item.ref.provider && p.accountId === item.ref.accountId && (item.ref.kind === 'container' ? d.containerId === item.ref.id : d.containerId === item.containerRef?.id && (!d.assigneeIds || d.assigneeIds.some(id => item.assigneeIds.includes(id))));
  }));
  if (!matches.length) return {
    matches,
    mode: ['create_task', 'create_container'].includes(intent.operation) ? 'clarify' : 'none'
  };
  if (intent.operation === 'progress') return {
    matches,
    mode: 'progress'
  };
  const item = matches[0],
    eligible = domains.filter(([, d]) => {
      const p = policy.providers[d.provider];
      return p.type === item.ref.provider && p.accountId === item.ref.accountId && (item.ref.kind === 'container' ? d.containerId === item.ref.id : d.containerId === item.containerRef?.id);
    });
  const same = (links ?? []).filter(link => link.username === intent.username && link.relation === 'same_commitment' && Number.isFinite(link.confirmedAt) && keyOf(link.workRef) === keyOf(item.ref));
  const auto = matches.length === 1 && eligible.length === 1 && intent.operation === 'complete' && !intent.edited && affirmativeCompletion(intent.statement, item.title) && same.length === 1 && eligible[0][1].role === 'tasks' && eligible[0][1].autoComplete === 'linked_explicit';
  return {
    matches,
    mode: auto ? 'auto' : 'clarify'
  };
}

/** Journal mentions must name one whole native title within the scoped view. */
export function groundedWorkMentions(statement, items) {
  const text = String(statement ?? '').normalize('NFC');
  return items.filter(item => {
    const title = normalized(item.title);
    if (!title || items.filter(other => normalized(other.title) === title).length !== 1) return false;
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(?:^|[^\\p{L}\\p{N}])' + escaped + '(?=$|[^\\p{L}\\p{N}])', 'iu').test(text);
  });
}
