# Vendor naming in the proxy application layer — LANDED

**Status: landed 2026-09-22.** Proposed and completed the same day, immediately
after the Libby identity-renewal work it was sequenced behind.

## Outcome

`3_applications/proxy/` no longer contains the vendor's name in any production
file. The Abstraction Test from `application-layer-guidelines.md` L13 now holds
for production code: a different library-media provider can be substituted
without editing an application module.

### Modules and ports renamed

| Was | Now |
|-----|-----|
| `LibbyStreamService` | `LibraryMediaStreamService` |
| `LibbyCoverService` | `LibraryMediaCoverService` |
| `LibbyBootstrapService` | `LibraryMediaBootstrapService` |
| `ports/ILibbyStreamGateway` | `ports/ILibraryMediaStreamGateway` |
| `ports/ILibbyBootstrapGateway` | `ports/ILibraryMediaBootstrapGateway` |

### Error codes renamed

Eight codes that escape the adapter boundary took a neutral `LIBRARY_MEDIA_`
prefix: `PROVIDER_FAILED`, `UNSUPPORTED_FULFILLMENT`, `LOAN_NOT_FOUND`,
`ORIGIN_REJECTED`, `LOAN_EXPIRED`, `CREDENTIAL_UNAVAILABLE`, `LEASE_EXPIRED`,
`CREDENTIAL_REJECTED`.

Comments and error *messages* in `LibraryMediaStreamService` were also cleaned,
per L230 ("vendor name in comments").

## Decisions worth keeping

**Three codes deliberately kept vendor-named.** `LIBBY_CHIP_REPLACED`,
`LIBBY_CHIP_UNKNOWN` and `LIBBY_RENEWAL_NOT_ADVANCED` are thrown and caught
entirely inside the adapter — the renewal service swallows them and logs the
code — so they never cross a layer boundary. They describe Libby's chip
protocol specifically, and neutralizing them would make them *less* accurate.
The rule is about what the application layer can see, not about banning a word.

**`LIBBY_LIVE_*` are not error codes.** An earlier scoping pass counted them in
and inflated the estimate. They are environment-variable names for the
daylight-browser live harness; renaming them would break shell and CI setups
for no architectural gain.

**Adapters and composition keep the vendor name, correctly.** `LibbyClient`,
`LibbyStreamGateway`, `LibbyStreamLeaseService`, `DaylightBrowserLibbyGateway`
and `5_composition/modules/libby.mjs` are all named right. `ddd-reference.md`
restricts composition by imports, not naming, and composition is precisely
where the vendor binding belongs — matching the existing `plexHubSessions.mjs`
and `plexSurfaceIdentity.mjs`.

**Two application test files still name the vendor, on purpose.**
`LibraryMediaStreamService.test.mjs` constructs the real `LibbyStreamGateway`
and `LibbyStreamLeaseService`, and both stream and bootstrap tests use
`listen.libbyapp.com` fixture URLs. Substituting fakes would delete real
coverage — the gateway's allowed-host enforcement is exercised through those
URLs, and a fake gateway would assert nothing about it. The coupling lives in
test files only and never reaches production. `ddd-reference.md`'s testing
table nominally prefers fakes at this layer; that is worth revisiting if these
tests are ever rewritten, but trading working host-allowlist coverage for
naming purity was judged a bad deal.

**Historical plan documents were left untouched.**
`docs/superpowers/plans/2026-09-21-*.md` still use the old names. They are
dated records of what was planned at the time; rewriting them would falsify the
history.

## Verification

- 199 tests green across `3_applications/proxy`, `1_adapters/.../libby`, and the
  Libby composition module.
- `composition-contract-registry` 13/13.
- ESM link gate clean — 3902 modules — which is what would catch a rename that
  broke an import path.
- `audit:layers` at baseline on every rule.

## Related

- [Identity renewal design](../_wip/plans/2026-09-22-libby-identity-renewal-design.md)
- [Application layer guidelines](../reference/core/layers-of-abstraction/application-layer-guidelines.md)
- [DDD reference](../reference/core/layers-of-abstraction/ddd-reference.md)
