// Pure triage item constructors. No I/O.
import { createHash } from 'node:crypto';

/**
 * @typedef {Object} TriageItem
 * @property {string} id        sha256 hex of the source ref's canonical JSON.
 * @property {'email'|'todo'} kind
 * @property {{provider: string, accountId: string, kind: string, id: string}} ref
 * @property {string} version
 * @property {Object} facts     MailMessage | WorkItem (plain object shape).
 */

export function refId(ref) {
  const canonical = JSON.stringify([ref.provider, ref.accountId, ref.kind, ref.id]);
  return createHash('sha256').update(canonical).digest('hex');
}

const build = (kind, source) => ({ id: refId(source.ref), kind, ref: source.ref, version: source.version, facts: source });

export const itemFromMail = (msg) => build('email', msg);
export const itemFromWork = (workItem) => build('todo', workItem);

/** Stable card id for one item at one version (a re-run never mints a second card). */
export const cardIdFor = (itemId, version) => `card.${createHash('sha256').update(`${itemId}@${version}`).digest('hex').slice(0, 32)}`;
