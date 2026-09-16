/**
 * Which Plex client identity a playback report belongs to.
 *
 * A "surface" is whatever mounted the Player — a fleet screen, or an ordinary
 * browser tab someone opened. ALL of them should register on Plex: if the
 * Player streamed Plex content, it was a real play and belongs in history.
 * The first version returned null for anything that was not a declared fleet
 * screen, which silently dropped every browser playback (a fitness video on a
 * laptop logged progress and appeared nowhere in Plex).
 *
 * Three cases, in order:
 *
 *   fleet:<name>     a declared household surface -> its own identity from
 *                    devices.yml, so the dashboard shows "Living Room TV".
 *   browser:<token>  an anonymous browser. The token is persisted in that
 *                    profile's localStorage, so it is STABLE and bounded by the
 *                    number of browser profiles — safe to derive an identifier
 *                    from, and it keeps two browsers from sharing one session.
 *   anything else    a User-Agent or nothing at all -> one shared web identity.
 *
 * NEVER a fresh identifier per request. Plex creates a permanent `devices` row
 * per distinct client identifier and reclaims none of them; doing that grew the
 * table to 81,009 rows and wedged the statistics pass for ~26s of every ~56s
 * (2026-09-16). Every identifier here is stable and bounded.
 */

import { PlexClientIdentity } from '#domains/media/value-objects/PlexClientIdentity.mjs';

/** Shared identity for callers that carry no stable per-browser token. */
export const WEB_CLIENT_IDENTIFIER = 'daylight-web';
export const WEB_DEVICE_NAME = 'DaylightStation Web';
const WEB_PRODUCT = 'DaylightStation';
const WEB_VERSION = '1.0';
const WEB_PLATFORM = 'Linux';

const FLEET_PREFIX = 'fleet:';
const BROWSER_PREFIX = 'browser:';

/** Keep a derived identifier to the characters Plex is happy to key on. */
function safeToken(raw) {
  return String(raw).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
}

/**
 * @param {object} deps
 * @param {{getHouseholdDevices: Function}} deps.configService
 * @param {string} deps.householdId
 * @param {object} [deps.logger]
 * @returns {(deviceId: string|null) => PlexClientIdentity|null}
 */
export function createPlexSurfaceIdentityResolver({ configService, householdId, logger = console }) {
  const webIdentity = (clientIdentifier) => new PlexClientIdentity({
    clientIdentifier,
    product: WEB_PRODUCT,
    version: WEB_VERSION,
    platform: WEB_PLATFORM,
    device: WEB_DEVICE_NAME,
  });

  return function identityFor(deviceId) {
    if (typeof deviceId !== 'string' || !deviceId.trim()) {
      // No identity at all — still a real play, so it lands under the shared
      // web identity rather than vanishing.
      return webIdentity(WEB_CLIENT_IDENTIFIER);
    }

    if (deviceId.startsWith(FLEET_PREFIX)) {
      const surfaceId = deviceId.slice(FLEET_PREFIX.length);
      const device = configService.getHouseholdDevices?.(householdId)?.devices?.[surfaceId];
      const plex = device?.plex;
      if (plex?.client_identifier) {
        try {
          return new PlexClientIdentity({
            clientIdentifier: plex.client_identifier,
            product: plex.product,
            version: plex.version,
            platform: plex.platform,
            // The name a viewer sees; never a kebab id.
            device: plex.device ?? device?.name ?? null,
          });
        } catch (error) {
          // A malformed `plex:` block must not silently drop the play.
          logger.warn?.('plex.session.identity_invalid', { surfaceId, error: error.message });
        }
      }
      // A fleet screen with no (or a broken) `plex:` block still played
      // something. Fall through to the web identity rather than reporting
      // nothing at all.
      return webIdentity(WEB_CLIENT_IDENTIFIER);
    }

    if (deviceId.startsWith(BROWSER_PREFIX)) {
      const token = safeToken(deviceId.slice(BROWSER_PREFIX.length));
      return webIdentity(token ? `${WEB_CLIENT_IDENTIFIER}-${token}` : WEB_CLIENT_IDENTIFIER);
    }

    return webIdentity(WEB_CLIENT_IDENTIFIER);
  };
}

export default createPlexSurfaceIdentityResolver;
