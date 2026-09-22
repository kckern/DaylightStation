# Media Integrations

This document records provider-specific integration boundaries for the Media
App. Integrations resolve a Daylight content ID into the normal media
contracts; they do not change the player or remote-surface protocol.

## Libby audiobooks

Libby loans are addressed by explicit content IDs:

```text
libby:loan/<card-id>/<title-id>
libby:loan/<card-id>/<title-id>/part/<part-key>
```

For example, the loan at `https://libbyapp.com/open/loan/<card-id>/<title-id>`
is addressed as `libby:loan/<card-id>/<title-id>`.

### Resolution and playback

The Libby adapter verifies that the card/title pair is an active loan, obtains
the provider's official open capability, and returns an ordinary Daylight
`PlayableItem`. Queue expansion returns the available audiobook parts in
spine order, with part title, duration, ordering, book title, author, narrator,
loan expiry, and a same-origin cover URL.

The media surface and remote devices use the regular AudioPlayer. No Libby
client or Playback Hub protocol is exposed to them.

### DaylightBrowser sidecar

Modern Libby fulfillment runs in the private `daylight-browser` Docker
sidecar. The sidecar is a provider-neutral Playwright service; its Libby
operation opens the official web player in a fresh, ephemeral Chromium
context and observes the short-lived audio capabilities that the player
itself requests.

The sidecar returns normalized metadata and the ordered capabilities only.
It does not return browser cookies, authorization headers, storage values, or
captured media bodies. The context is closed after fulfillment, and provider
URLs remain process-local leases in the backend. The sidecar has no public
host port and is reachable only over the private Docker network.

The backend proxies the authorized audio bytes through the normal media
stream endpoint, including HTTP range requests for seeking. It does not
permanently download, catalog, or retain the audiobook.

### Authentication and expiry

The Libby credential is a device **chip identity** token, read from the
configured account credential file. It carries roughly a seven-day life.

The backend keeps it current through the provider's own renewal call — the same
one the official client makes — which returns a fresh identity on the **same
chip**. Renewal is driven by a self-arming timer keyed off the token's own
expiry, so it is independent of playback: an account that goes unused for a week
stays authenticated. Only the instance that owns scheduled work renews, because
the credential file is shared and must have exactly one writer.

Renewal requires a live credential and is guarded: a response carrying a
different chip, or an expiry that does not advance, is rejected and the stored
token is left untouched. The sidecar must still not attempt to manufacture or
reverse-engineer a passkey/token exchange; none is needed.

There are two independent expiry windows:

1. **Chip identity.** Renewal keeps this current automatically. If it does lapse
   — the host was off longer than the token's remaining life — recovery is the
   provider's `chip/clone/code` pairing ceremony: generate an eight-digit code in
   the Libby app and supply it once. New browser fulfillments fail until then.
2. **Signed media capability.** When the provider URL expires, the adapter may
   resolve the active loan again and issue a fresh process-local lease. If the
   chip identity is also expired, that recovery stops at authentication.

The adapter must fail closed for a missing, malformed, expired, or
unauthorized credential. Tokens, cookies, signed URLs, and lease handles must
never be written to logs or returned as API metadata.

### Provider boundary and compliance

Libby integration is intentionally limited to an account's active loans and
the official playback path. It honors the provider's signed URLs and their
expiry, keeps buffering ephemeral, and exposes only the portions observed by
the official player. It is not a general downloader, archive, DRM circumvention
layer, or account automation surface.

For the wire-level content-resolution contract, see
[`media-app-technical.md`](./media-app-technical.md#21-content-resolution).
For sidecar networking, configuration, and deployment, see the
[DaylightBrowser runbook](../../runbooks/daylight-browser.md).
