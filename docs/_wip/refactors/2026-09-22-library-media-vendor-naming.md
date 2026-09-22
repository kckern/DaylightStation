# Vendor naming in the proxy application layer

**Status: proposed. No code has moved.** Nothing in this refactor has been
executed; the only thing that exists is this page and the decision to sequence
it after the Libby identity-renewal work (which has landed).

## What this is

`3_applications/proxy/` carries the vendor's name throughout, which the
application layer's own guidelines forbid:

- `application-layer-guidelines.md` L13 — *"if you could swap Telegram for
  Discord, Plex for Jellyfin... without touching any file in `3_applications/`,
  your abstraction is correct"*
- L58 — *"Never: `telegramClient`, `openaiService`, `plexAdapter`"*
- L229 — vendor name in code → use `messagingGateway`, `mediaRepository`

`decision-register.md` records **no** exception for proxy or Libby. The only
decision there, D1, is about containers not importing concrete adapters. So
this is drift, not a sanctioned carve-out.

Affected today:

| File | Proposed name |
|------|---------------|
| `3_applications/proxy/LibbyStreamService.mjs` | `LibraryMediaStreamService` |
| `3_applications/proxy/LibbyCoverService.mjs` | `LibraryMediaCoverService` |
| `3_applications/proxy/LibbyBootstrapService.mjs` | `LibraryMediaBootstrapService` |
| `3_applications/proxy/ports/ILibbyStreamGateway.mjs` | `ILibraryMediaStreamGateway` |
| `3_applications/proxy/ports/ILibbyBootstrapGateway.mjs` | `ILibraryMediaBootstrapGateway` |

Adapters keep their vendor names — `LibbyClient`, `LibbyStreamGateway`,
`DaylightBrowserLibbyGateway` are implementations and are named correctly.
`5_composition/modules/libby.mjs` also keeps its name: composition is the
wiring seam where the vendor binding belongs, and `ddd-reference.md` restricts
that layer by imports, not naming. In-tree precedent agrees —
`5_composition/modules/` already holds `plexHubSessions.mjs` and
`plexSurfaceIdentity.mjs`.

## The part that makes this bigger than a rename

The cross-layer **error codes** are vendor-named too: `LIBBY_LOAN_EXPIRED`,
`LIBBY_CREDENTIAL_UNAVAILABLE`, `LIBBY_LEASE_EXPIRED`, `LIBBY_LOAN_NOT_FOUND`
and others — 16 distinct codes, ~102 references, in `1_adapters`,
`3_applications`, docs, and the daylight-browser extension tests.

Those codes *are* the contract between layers. Renaming the modules but leaving
`LIBBY_*` flowing through `3_applications` means the swap test still fails, so a
half-rename is churn that buys nothing. **Do both or neither.**

This is also the risk: a missed error-code rename changes runtime error
handling, and the regression is invisible until an error path fires. That is
why it was kept out of a deploy.

## Scope

- Modules, classes and ports: ~66 references across 13 code files, 2 docs.
- Error codes: ~102 references, 16 codes.
- `4_api` does not consume the codes directly, which contains the blast radius.

## Where everything is

- Guidelines: [`application-layer-guidelines.md`](../../reference/core/layers-of-abstraction/application-layer-guidelines.md)
- Layer rules and the sanctioned-zone definition: [`ddd-reference.md`](../../reference/core/layers-of-abstraction/ddd-reference.md)
- Exceptions register (contains none for this): [`decision-register.md`](../../reference/core/layers-of-abstraction/decision-register.md)
- The work this was sequenced behind: [`2026-09-22-libby-identity-renewal-design.md`](../plans/2026-09-22-libby-identity-renewal-design.md)

## Next action

Rename modules, ports and all 16 error codes in one change, then run the full
isolated suite plus `npm run audit:layers` before merging. Authorized by the
sequencing decision of 2026-09-22: renewal ships first, this follows as its own
reviewable change.
