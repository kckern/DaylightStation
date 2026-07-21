/**
 * `logScaleBasis` — which participants define the coin chart's log curve.
 *
 * The 3+ participant branch of `scaleY` pins the LOWEST participant to 25% of
 * chart height:
 *
 *     k = log(0.25) / log(normLow);  mapped = norm ** k
 *
 * which makes the curve exquisitely sensitive to that lowest value. A
 * participant who joins two thirds of the way in and sits near zero drags
 * `normLow` toward 0, drives `k` toward 0, and flattens everyone who actually
 * raced into a compressed band at the top of the chart.
 *
 * Exempt participants (`governance.exemptions`) are non-subjects: along for the
 * ride, never governed, never blamed. They should still be DRAWN — they just
 * must not be the BASIS of the scale. With them excluded the curve spreads the
 * real field out and the exempt line renders flat near the bottom, which is the
 * intended reading.
 *
 * Exemption suspension is MODELLED ON `GovernanceEngine._exemptionsApply` but is
 * deliberately not exact parity: the engine also requires an ACTIVE, non-guest
 * subject, whereas this counts guests and absent/historical entries as subjects.
 * That divergence is safe because this feeds the y-scale only and never
 * governance. The rule: when NO
 * non-exempt participant is present the exemption is suspended and everyone
 * counts, so an exempt-only roster still gets a usable scale rather than an
 * empty basis.
 */

/** Parity with GovernanceEngine's private `normalizeName` (exemptions are usernames). */
const normalizeName = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

/**
 * @param {{ id?: string, profileId?: string }} entry
 * @param {string[]} [exemptions] - usernames from config.governance.exemptions
 * @returns {boolean}
 */
export function isExemptEntry(entry, exemptions) {
  if (!Array.isArray(exemptions) || exemptions.length === 0) return false;
  const id = normalizeName(entry?.id || entry?.profileId);
  if (!id) return false;
  return exemptions.some((name) => normalizeName(name) === id);
}

/**
 * Lowest final value among the participants that define the scale.
 *
 * @param {Array<{ id?: string, profileId?: string, lastValue?: number }>} entries
 * @param {string[]} [exemptions] - usernames from config.governance.exemptions
 * @param {number} minDataValue - fallback when no entry has a finite value
 * @returns {number} never negative
 */
export function computeScaleBasisValue(entries, exemptions, minDataValue) {
  const all = Array.isArray(entries) ? entries : [];
  const subjects = all.filter((e) => !isExemptEntry(e, exemptions));
  // Suspension: with no non-exempt participant, everyone defines the basis.
  const basis = subjects.length > 0 ? subjects : all;

  let min = Number.POSITIVE_INFINITY;
  basis.forEach((entry) => {
    if (Number.isFinite(entry?.lastValue) && entry.lastValue < min) {
      min = entry.lastValue;
    }
  });

  if (min === Number.POSITIVE_INFINITY) return Math.max(0, minDataValue);
  return Math.max(0, min);
}
