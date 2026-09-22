# Kanopy Adapter — Design

**Date:** 2026-09-22
**Status:** Design, not implemented

Kanopy is the second library-media provider, and the first real test of whether
the `LibraryMedia*` ports generalize beyond Libby.

## What was verified

Against a live account, read-only (no `POST /kapi/plays` was issued — that
records a view against the library's license and is not ours to spend while
exploring):

| Question | Finding |
|---|---|
| Is the content DRM-free? | **Per title.** `2474245` is plaintext HLS. `14634419` is DASH with Widevine **and** PlayReady under `cenc`. |
| Does metadata disclose DRM? | **No.** `/kapi/videos/{id}` has no DRM field. Protection is only discoverable by fetching the manifest. |
| Plaintext evidence | Master playlist has an *empty* `# FairPlay Info` block; no `#EXT-X-KEY` or `#EXT-X-SESSION-KEY` in any variant; segments are MPEG-TS (`0x47` sync) with no `pssh`/`sinf`/`senc`/`tenc` boxes. |
| Range requests | Segments return `206`, so the existing range-preserving relay works. |
| Auth required for the manifest | **None.** `/kapi/manifests/hls/{id}.m3u8` returns the full playlist with no cookie and no bearer. |

## The two facts that shape the design

**1. DRM is a per-title property and is invisible until fulfillment.**
There is no metadata flag to filter on. The adapter must fetch the manifest and
inspect it at fulfillment time, then fail closed. This is structurally the same
guard `LibbyClient.#normalizeFulfillment` already applies via
`openbook.encryption || openbook.license` — evidence the existing port contract
encodes the right idea.

**2. The manifest endpoint is unauthenticated, and we will authenticate anyway.**
Because no credential is required to fetch a playlist, it is technically
possible to stream without ever identifying the account. We will not do that.
`POST /kapi/plays` is how Kanopy records a view against the library's license;
skipping it would use an access-control gap to avoid the metering that makes
the service free to the household. The adapter authenticates, records the play,
and only then fulfills. **This constraint is self-imposed, not enforced by the
provider** — which is exactly why it belongs in writing.

## Port fit

| Port | Fits? | Notes |
|---|---|---|
| `ILibraryMediaBootstrapGateway` | Partly | Kanopy needs no browser sidecar; resolution is a plain authenticated JSON call. The port's shape (resolve → normalized spine) still fits. |
| `ILibraryMediaStreamGateway` | **Needs extension** | Contract assumes a per-part upstream URL relayed with ranges. Kanopy is one playlist over ~112 segments. |

The stream port is where the abstraction genuinely strains, and it should be
extended rather than contorted.

### Options for the stream shape

- **(a) One "part" per TS segment.** 112 parts. Fits the current contract with
  no changes, and produces a player experience nobody wants — a video is not a
  112-track album.
- **(b) Proxy the playlist (recommended).** Serve a rewritten `.m3u8` whose
  segment URLs point back at our proxy, and relay each segment through the
  existing range-preserving path. The client sees one ordinary HLS source.
- **(c) Hand the client Kanopy's playlist URL.** Simplest, but segment URLs are
  signed with an `e=` expiry, and it puts provider URLs in the browser — which
  the Libby design deliberately avoids.

Recommend **(b)**. It reuses the relay and lease machinery and keeps provider
URLs process-local, consistent with the existing boundary.

## Content addressing

```text
kanopy:video/<videoId>
```

Matching the existing `libby:loan/<card-id>/<title-id>` convention.

## Fulfillment sequence

1. Resolve `/kapi/videos/{videoId}?domainId=&ageRatingDomainId=` for metadata.
2. `POST /kapi/plays` with `{videoId, userId, domainId}` to record the view.
3. Fetch `/kapi/manifests/hls/{id}.m3u8`; if a DASH manifest exists instead, or
   any `ContentProtection` / `EXT-X-KEY` / `EXT-X-SESSION-KEY` is present,
   throw `LIBRARY_MEDIA_UNSUPPORTED_FULFILLMENT` and stop.
4. Select a variant, mint a process-local lease, and serve a rewritten playlist.
5. Relay segments through the existing range-preserving gateway.

## Metadata mapping

`/kapi/videos/{id}` returns: `videoId`, `title`, `alias`, `descriptionHtml`,
`durationSeconds`, `productionYear`, `quality`, `images.{posters,landscapes}.{small,medium,large}`,
`taxonomies.{subjects,tags,filmmakers,cast,languages,supplier}`, `hasCaptions`,
`captionLabels`, `captionLanguages`, `audioTrackLabels`, `isKids`, `isFree`,
`hasPublicPerformanceRights`, `starRating`.

Covers proxy same-origin, as Libby's do.

## Allowed hosts

`www.kanopy.com`, `kcms.kanopy.com` (variant playlists), `chunks.kanopy.com`
(segments). The existing host-allowlist gate in the stream gateway applies
unchanged.

## Credentials

A `kapi` JWT bearer. Note its `exp` decodes to **2036** — effectively
non-expiring, so none of the renewal machinery built for Libby's 7-day chip
identity is needed here. Stored per the existing convention at
`data/users/<user>/auth/kanopy.yml`, read fail-closed, never logged.

The browser session also carries a `cf_clearance` Cloudflare cookie, but the
endpoints we need do not require it, so the adapter must not depend on one —
`cf_clearance` is bound to a browser fingerprint and would be unreproducible
server-side.

## Guards

1. **Fail closed on any protection signal**, checked at fulfillment, never
   inferred from metadata.
2. **Prefer refusal to guessing**: absence of an HLS manifest is not a licence
   to look for another route to the bytes.
3. Record the play before fulfilling; a failed play call aborts fulfillment.
4. Never log tokens, signed URLs, or lease handles.
5. Buffering stays ephemeral — no archiving, matching the Libby boundary.

## Open questions

- Does `isFree` or `supplier` correlate with plaintext delivery? Suspected from
  a sample of two, which is not evidence. Worth measuring before assuming any
  title class is safe to skip the manifest check for — and the check is cheap
  enough that the answer may not matter.
- Does `POST /kapi/plays` return anything needed for fulfillment (a session or
  token), or is it purely accounting? Untested, because calling it spends a play.
- Play credits: `/kapi/memberships` returned an empty list for this account, so
  the entitlement model is not yet understood.

## Testing

Unit tests per guard against a fake gateway: DASH-with-ContentProtection
refused, `EXT-X-KEY` refused, missing manifest refused, play-call failure
aborts. One live test gated like `libby-bootstrap.live.mjs`, pointed at a known
plaintext title.
