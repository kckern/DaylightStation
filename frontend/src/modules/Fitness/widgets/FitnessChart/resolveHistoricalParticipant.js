/**
 * Resolve an offline (historical) participant's display fields.
 *
 * Resolution chain (first non-empty wins):
 *   1. participantDisplayMap.get(slug) — live zone-profile-backed display
 *   2. sessionParticipantsMeta.get(slug) — persisted session metadata
 *   3. Capitalized slug as last resort
 *
 * Avatar URL uses the canonical `api/v1/static/img/users/<slug>` path that
 * DaylightMediaPath produces for the live path — the server only serves
 * avatars from this route, so the legacy `/static/img/users/...` URL 404s
 * and causes broken images for dropped-out participants. We inline the
 * path form (no DaylightMediaPath call) to keep this helper pure/node-
 * testable; the browser resolves the relative path against the same
 * origin as the live-path avatars.
 *
 * Extracted to a `.js` file (not `FitnessChart.jsx`) so jest can import it
 * without needing a JSX transform.
 *
 * @param {string} slug
 * @param {{ displayMap?: Map, sessionMeta?: Map }} sources
 * @returns {{ name: string, avatarUrl: string|null, profileId: string|null }}
 */
export const resolveHistoricalParticipant = (slug, sources = {}) => {
	if (!slug || typeof slug !== 'string') {
		return { name: 'Unknown', avatarUrl: null, profileId: null };
	}
	const key = slug.trim().toLowerCase();
	const displayMap = sources.displayMap instanceof Map ? sources.displayMap : null;
	const sessionMeta = sources.sessionMeta instanceof Map ? sources.sessionMeta : null;

	const dmEntry = displayMap?.get(key) || null;
	const metaEntry = sessionMeta?.get(slug) || sessionMeta?.get(key) || null;

	const capSlug = key.charAt(0).toUpperCase() + key.slice(1);

	const dmName = dmEntry?.displayName;
	const dmNameIsReal = dmName && String(dmName).trim().toLowerCase() !== key;
	let name = capSlug;
	if (dmNameIsReal) name = dmName;
	else if (metaEntry?.displayName && String(metaEntry.displayName).trim()) name = metaEntry.displayName;
	else if (metaEntry?.name && String(metaEntry.name).trim()) name = metaEntry.name;

	// Prefer the zone-profile-backed avatarSrc (already a fully-formed URL).
	// Otherwise derive from the slug using the canonical `api/v1/static/img/`
	// path — matches what DaylightMediaPath produces so the server serves it.
	const avatarUrl = dmEntry?.avatarSrc || `api/v1/static/img/users/${key}`;

	return {
		name,
		avatarUrl,
		profileId: dmEntry?.id || slug
	};
};
