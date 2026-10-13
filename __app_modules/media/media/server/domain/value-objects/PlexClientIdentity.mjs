/**
 * PlexClientIdentity — who a surface says it is when it plays something.
 *
 * A value object: two identities with the same attributes ARE the same client.
 *
 * `clientIdentifier` is the primary key of a Plex device and is PERMANENT.
 * Changing it does not rename a device — it creates a new one, and the old row
 * is never reclaimed. That is not a theoretical concern here: minting a fresh
 * identifier per request grew the server's `devices` table to 81,009 rows and
 * wedged Plex's statistics pass for ~26s out of every ~56s (2026-09-16). So the
 * identifier is DECLARED in devices.yml and validated here, never generated.
 *
 * `device` is the human-facing name — "Living Room TV" — and is what a viewer
 * sees as the player on the Plex dashboard. `product` is the application
 * ("DaylightStation"). Real Plex clients keep these distinct (name "Android" /
 * product "Plexamp"), and so do we.
 *
 * Deliberately knows NOTHING about HTTP. The `X-Plex-*` header spelling is Plex
 * wire format and belongs to the adapter; this object only holds the values.
 */

import { ValidationError } from '#domains/core/errors/index.mjs';

/** Anything longer is a caller mistake, not an identifier. */
const MAX_FIELD_LENGTH = 255;

function requireText(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ValidationError(`PlexClientIdentity.${field} is required`, { field, value });
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_FIELD_LENGTH) {
    throw new ValidationError(`PlexClientIdentity.${field} is too long`, { field });
  }
  return trimmed;
}

function optionalText(value, field) {
  if (value === undefined || value === null || value === '') return null;
  return requireText(value, field);
}

export class PlexClientIdentity {
  #clientIdentifier;
  #product;
  #version;
  #platform;
  #device;

  /**
   * @param {object} props
   * @param {string} props.clientIdentifier - permanent, declared in devices.yml
   * @param {string} props.product - the application name, e.g. "DaylightStation"
   * @param {string} [props.version] - application version
   * @param {string} [props.platform] - drives which stock icon Plex renders
   * @param {string} [props.device] - human-facing name, e.g. "Living Room TV"
   */
  constructor({ clientIdentifier, product, version = null, platform = null, device = null } = {}) {
    this.#clientIdentifier = requireText(clientIdentifier, 'clientIdentifier');
    this.#product = requireText(product, 'product');
    this.#version = optionalText(version, 'version');
    this.#platform = optionalText(platform, 'platform');
    this.#device = optionalText(device, 'device');
    Object.freeze(this);
  }

  get clientIdentifier() { return this.#clientIdentifier; }
  get product() { return this.#product; }
  get version() { return this.#version; }
  get platform() { return this.#platform; }
  get device() { return this.#device; }

  /** The name a person should see. Never the raw identifier. */
  get displayName() { return this.#device ?? this.#product; }

  /** Value equality — no identity field, by definition. */
  equals(other) {
    return other instanceof PlexClientIdentity
      && other.clientIdentifier === this.#clientIdentifier
      && other.product === this.#product
      && other.version === this.#version
      && other.platform === this.#platform
      && other.device === this.#device;
  }
}

export default PlexClientIdentity;
