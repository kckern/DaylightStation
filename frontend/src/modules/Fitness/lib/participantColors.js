// Identity palette — deliberately distinct from the HR zone palette
// (blue/green/yellow/orange/red/gray). Used as a soft underglow + avatar ring so a
// racer's line is traceable WITHOUT replacing the zone-colored stroke (audit Sin 11).
// Order chosen so the FIRST FIVE (the common roster size) are maximally separated
// from each other AND from the zone palette: violet, magenta, teal, periwinkle, taupe.
// (Earlier coral read like the orange zone, and two purples sat too close — vision-tuned.)
export const IDENTITY_PALETTE = Object.freeze([
	'#b388ff', // violet
	'#ff6fd8', // magenta-pink
	'#00bfa5', // teal
	'#8c9eff', // periwinkle (blue-purple — clearly apart from violet)
	'#a1887f', // taupe (muted — does not read as the warm orange zone)
	'#26c6da', // cyan (only reached for a 6th rider)
]);

/**
 * Assign a stable identity color to each participant id. Assignment is by sorted-id
 * order so the same roster always yields the same colors regardless of render order.
 * @param {string[]} ids
 * @returns {Map<string,string>}
 */
export function assignIdentityColors(ids = []) {
	const clean = [...new Set((ids || []).filter(Boolean).map(String))].sort((a, b) => a.localeCompare(b));
	const map = new Map();
	clean.forEach((id, i) => map.set(id, IDENTITY_PALETTE[i % IDENTITY_PALETTE.length]));
	return map;
}
