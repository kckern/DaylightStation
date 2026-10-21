/**
 * The agenda's economy port: `bankSummary(learnerId)` for `BuildAgenda`'s
 * economy line ("In the bank: 7 silver · Next: Math").
 *
 * Built at composition from two things School is handed, so School imports no
 * economy code:
 *
 * - `economyService`, read by duck typing. Silver is
 *   `peekBalance(id).silver`, the UNSPENT silver in the bank (the figure the
 *   Portal strip shows and the week close converts on Sunday), not the week's
 *   mints. `peekBalance` is a pure ledger fold: no wallet write, no session
 *   reap, so the agenda preview stays read-only and a print that gives up on
 *   the call leaves nothing behind.
 * - `previewNext(learnerId)`, School's own dry-run "what would print next"
 *   (`IssueSubjectNext.preview`), for the title and reward.
 *
 * - `economyMode()`, the economy catalog's mode, read on every print.
 *
 * Answers:
 * - `null` (no line) unless the mode is `live`, and the balance is not read.
 *   Before coins are live every bank reads 0, and "0 silver" on a kid's tape
 *   says their work was worth nothing. No mode reader means no line too.
 * - `null` (no line) for a learner the economy does not know
 *   (`hasUser` false). That is configuration, not a fault: logged once per
 *   learner at info (`school.agenda.economy-unknown-user`), never per print.
 * - a failed preview still answers the silver, with `next: null`, logged at
 *   warn (`school.agenda.economy-next-failed`).
 * - a failed balance read throws; `BuildAgenda` catches it, logs
 *   `school.agenda.economy-failed` at warn and prints no line.
 *
 * No `peekBalance`, no port: `null`, and the agenda prints as it always did.
 *
 * @param {object} args
 * @param {object|null} args.economyService
 * @param {(learnerId: string) => Promise<{unit?: {title?: string}|null, reward?: object|null}|null>} args.previewNext
 * @param {(() => string)|null} [args.economyMode] - the catalog mode (`off`, `dry-run`, `live`)
 * @param {object} [args.logger]
 * @returns {{bankSummary: (learnerId: string) => Promise<{silver: number,
 *   next: {title: string, reward: object|null}|null}|null>}|null}
 */
export function createAgendaEconomyPort({ economyService, previewNext, economyMode = null, logger = console }) {
  if (typeof economyService?.peekBalance !== 'function') return null;
  const reportedUnknown = new Set();
  return {
    async bankSummary(learnerId) {
      if (typeof economyMode !== 'function' || economyMode() !== 'live') return null;
      if (typeof economyService.hasUser === 'function' && !economyService.hasUser(learnerId)) {
        if (!reportedUnknown.has(learnerId)) {
          reportedUnknown.add(learnerId);
          logger.info?.('school.agenda.economy-unknown-user', { learnerId });
        }
        return null;
      }
      const [balances, next] = await Promise.all([
        economyService.peekBalance(learnerId),
        Promise.resolve()
          .then(() => previewNext(learnerId))
          .then((preview) => (preview?.unit?.title
            ? { title: preview.unit.title, reward: preview.reward ?? null }
            : null))
          .catch((error) => {
            logger.warn?.('school.agenda.economy-next-failed', { learnerId, error: error?.message ?? String(error) });
            return null;
          }),
      ]);
      return { silver: balances?.silver ?? null, next };
    },
  };
}
