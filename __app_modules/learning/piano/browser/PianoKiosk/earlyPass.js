/**
 * The piano kiosk's side of the early pass: one game a day, bought with silver
 * or gold, before the day's schoolwork is done (school economy slice 1, C5).
 *
 * Economy owns the purchase, the cap, the price and the refund window
 * (`__docs/reference/economy/economy.md`, "Early passes"). This file is the
 * kiosk's HTTP seam to it and the few pure reads the lock screen and the menu
 * tile share, so the two never disagree about whether a pass is for sale.
 *
 * Every call goes through `DaylightAPI`, which throws on a non-2xx with
 * `error.status` set and, when the body is JSON, `error.body`; `errorBody`
 * reads it (falling back to the copy after " - " in the message).
 */
import { DaylightAPI } from '../../../../../frontend/src/lib/api.mjs';

/** The privilege the piano's pass opens. `pass` and `offers` are keyed by it. */
export const EARLY_PASS_PRIVILEGE = 'piano.games';
/**
 * Under this much play, a game that ends hands the coins back. The server
 * records its own `refund_within_ms` on the purchase and bounds a refund by
 * its own clock too, so this is the client's half of the rule, never the
 * whole of it: a refund can still be refused.
 */
export const REFUND_WITHIN_MS = 60_000;

const economyUser = (learnerId) => `api/v1/economy/users/${encodeURIComponent(learnerId)}`;
const passPath = (learnerId, passId) => `${economyUser(learnerId)}/passes/${encodeURIComponent(passId)}`;

/** The JSON body of a failed `DaylightAPI` call, or null when it had none. */
export function errorBody(error) {
  if (error?.body && typeof error.body === 'object') return error.body;
  const message = String(error?.message ?? '');
  const at = message.indexOf(' - ');
  if (at < 0) return null;
  try {
    const body = JSON.parse(message.slice(at + 3));
    return body && typeof body === 'object' ? body : null;
  } catch {
    return null;
  }
}

/** Today's `piano.games` pass from a bank payload, or null when the bank does not list one. */
export function passFromBank(bank) {
  const pass = bank?.pass?.[EARLY_PASS_PRIVILEGE];
  return pass && typeof pass === 'object' ? pass : null;
}

/**
 * The `piano.games` quote rows (`[{coin, price, affordable}]`). Empty when not
 * for sale, and empty when the ledger could not be read (`state: 'unknown'`):
 * a sale offered against a ledger nobody can read is a sale nobody can check.
 */
export function offersFromBank(bank) {
  const pass = passFromBank(bank);
  if (!pass || pass.state === 'unknown') return [];
  const rows = bank?.offers?.[EARLY_PASS_PRIVILEGE];
  return Array.isArray(rows)
    ? rows.filter((row) => row && typeof row.coin === 'string' && Number.isFinite(row.price) && row.price > 0)
    : [];
}

/** True when today's pass cap is spoken for and no pass is waiting to be played. */
export function passCapUsed(access) {
  const pass = access?.pass;
  return Boolean(pass) && pass.state !== 'unknown' && pass.state !== 'active' && pass.capUsed === true;
}

/** The offers a child can buy right now: school says incomplete, the cap is free, and they can afford it. */
export function affordableOffers(access) {
  if (!access || access.unlocked || access.status !== 'ready' || access.state !== 'incomplete') return [];
  const pass = access.pass;
  if (!pass || pass.state === 'unknown' || pass.state === 'active' || pass.capUsed !== false) return [];
  return (access.offers ?? []).filter((row) => row.affordable === true);
}

/** Whether the lock can sell a pass right now (an affordable offer exists). */
export function canBuyPass(access) {
  return affordableOffers(access).length > 0;
}

/**
 * Whether a school-locked Games tile still leads somewhere: today's pass cap
 * is unused and the ledger was readable. Affordable or not — a child with no
 * silver can still reach the lock's Print button and earn some.
 */
export function canEnterLock(access) {
  if (!access || access.unlocked || access.status !== 'ready' || access.state !== 'incomplete') return false;
  const pass = access.pass;
  return Boolean(pass) && pass.state !== 'unknown' && pass.state !== 'active' && pass.capUsed === false;
}

export const readBank = (learnerId) => DaylightAPI(`${economyUser(learnerId)}/bank`);

export const buyPass = (learnerId, coin) => DaylightAPI(
  `${economyUser(learnerId)}/passes`, { privilege: EARLY_PASS_PRIVILEGE, coin }, 'POST',
);

export const consumePass = (learnerId, passId, playedMs) => DaylightAPI(
  `${passPath(learnerId, passId)}/consume`, { playedMs }, 'POST',
);

export const refundPass = (learnerId, passId, playedMs, reason) => DaylightAPI(
  `${passPath(learnerId, passId)}/refund`, { playedMs, reason }, 'POST',
);

export const readCompletion = (learnerId) => DaylightAPI(
  `api/v1/school/lifecycle/learners/${encodeURIComponent(learnerId)}/completion`,
);

const selfService = (learnerId) => `api/v1/school/self-service/learners/${encodeURIComponent(learnerId)}`;

export const readNextSheet = (learnerId) => DaylightAPI(`${selfService(learnerId)}/next`);

export const printNextSheet = (learnerId, deviceId = null) => DaylightAPI(
  `${selfService(learnerId)}/print-next`, deviceId ? { deviceId } : {}, 'POST',
);

/** `{done, total}` from School's completion read: served against served plus obligated. Null when there is nothing to count. */
export function schoolProgress(completion) {
  const sections = Array.isArray(completion?.sections) ? completion.sections : [];
  const done = sections.filter((s) => s?.state === 'served').length;
  const total = done + sections.filter((s) => s?.state === 'obligated').length;
  return total > 0 ? { done, total } : null;
}

/**
 * The Print button's label from `GET .../next`: "Print my next sheet (Math
 * 4-02)", with "+2 silver · " / "+1 gem · " only when the economy prices the
 * unit — the same reward words as the Portal's bank strip. Null when nothing
 * would print. The reward is never made up: `reward: null` (anything but a
 * live economy that prices the sheet) shows no amount.
 */
export function nextSheetLabel(next) {
  const unit = next?.unit;
  if (!unit || next.printable !== true) return null;
  const title = unit.title || unit.unitId;
  if (!title) return null;
  const silver = next.reward?.silver;
  const gems = next.reward?.gems;
  const parts = [];
  if (Number.isFinite(silver) && silver > 0) parts.push(`+${silver} silver`);
  if (Number.isFinite(gems) && gems > 0) parts.push(`+${gems} gem${gems === 1 ? '' : 's'}`);
  return `Print my next sheet (${[...parts, title].join(' · ')})`;
}
