# Media Integrations

This document records provider-specific integration boundaries for the Media
App. Integrations resolve a Daylight content ID into the normal media
contracts; they do not change the player or remote-surface protocol.

## Provider capability boundary

The application layer speaks in `LibraryMedia*` terms and knows no provider by
name. What it does encode is a policy: **the proxy relays only media we may
lawfully relay.** That is why `ILibraryMediaStreamGateway` assumes plaintext
byte ranges — a DRM-protected provider cannot satisfy it, and that is the
correct outcome rather than a gap to fill.

Three rules follow, and they apply to every provider:

1. **Protection is checked at fulfillment, never inferred from metadata.**
   A provider may serve some titles in the clear and others under DRM from the
   same catalogue and the same API, with nothing in the metadata to
   distinguish them. The adapter inspects the actual manifest and fails closed
   on any protection signal — a DASH `ContentProtection` element, an HLS
   `EXT-X-KEY` or `EXT-X-SESSION-KEY`, or `encryption` / `license` on a
   fulfillment spine.
2. **Refusal is the answer, not another route.** When a title is protected, the
   integration stops. It does not look for a different endpoint, a lower
   tier, or an unprotected copy of the same work.
3. **An absent lock is not a licence.** Where a provider's manifest happens to
   need no authentication, the adapter still authenticates and still records
   the view through the provider's own accounting path. Library services are
   free to the household because a library pays per circulation; quietly
   consuming that without being counted is not a technicality.

A provider that cannot meet these is not thereby excluded from the app — it is
excluded from *the proxy*. Catalogue and deep-link integrations remain
available, and are the right home for DRM-protected services.

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

## Kanopy video

**Designed, not implemented.** See
[the design](../../_wip/plans/2026-09-22-kanopy-adapter-design.md).

Kanopy is addressed as:

```text
kanopy:video/<video-id>
```

Kanopy is the case the capability boundary above was written for. Verified
against a live account: one title is served as plaintext HLS with no
`EXT-X-KEY` in any variant and MPEG-TS segments carrying no encryption boxes,
while another is DASH under both Widevine and PlayReady. Nothing in
`/kapi/videos/{id}` distinguishes them, so protection is knowable only by
fetching the manifest.

Consequences for the adapter:

- Fulfillment fetches the HLS manifest and refuses anything carrying a
  protection signal, or anything offered only as DASH.
- A view is recorded through the provider's own play endpoint before
  fulfillment. The manifest endpoint happens to require no credential at all;
  the adapter authenticates and records the play regardless, per rule 3 above.
- Delivery is a playlist over many segments rather than discrete parts, so the
  proxy serves a rewritten playlist whose segment URLs point back at itself.
  Provider URLs stay process-local, as with Libby.
- The account credential is a long-lived bearer token, so none of the identity
  renewal built for Libby applies.

For the wire-level content-resolution contract, see
[`media-app-technical.md`](./media-app-technical.md#21-content-resolution).
For sidecar networking, configuration, and deployment, see the
[DaylightBrowser runbook](../../runbooks/daylight-browser.md).
