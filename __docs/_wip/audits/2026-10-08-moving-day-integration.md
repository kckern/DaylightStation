# Moving-day integration

Birthday queries and slideshow playback were published first in `66460e3263`.
The remaining development work is consolidated onto that public main revision.
Unpublished integration history is retained locally before consolidation because
its intermediate commits contain household identifiers that cannot be published.
Private runtime configuration is not part of this publication.

Local recovery ref: `backup/moving-day-integration-20261008` at
`f3c6cd3d722da61bcc772ea3dde69a8621ee6dc8` (full integration history; do not publish this private-history ref).

## Integrated branch tips

| Branch | Tip |
| --- | --- |
| release/media-final | 3e89448fd7313bd375c8b3a73c15f77db823f6ba |
| feat/codex-usage | 371b1441dab7731d6a9c94b8a59b09c0b3e01b6f |
| feature/fitness-truthful-episodes | 8db20d356abe79d82a879bda9cd174164466aa41 |
| fix/skyline-glider-child-ready | 35b05c9005e5618fa9c87f2c152c09acee744297 |
| feat/skyline-state-gate | f4d99bb2b3c9b2a1d6ec0948494666487fc94a10 |
| fix/unattended-child-policy | 4d84a003fe5fe749c9342cfd530859ab19c60fdc |
| feat/health-log-controls | 5824877c612557ae4ea807adf542985568db5a40 |
| feat/health-log-display | c5fb67ceed3bef2319c3250f72848a9d84d3ae08 |
| feat/reading-shelf-experience | b30762039f5caea5e31e4c6c85993a3f3d2a110d |
| feature/learn-ux-unslop | a0d664e8a5d21fb6587d91188e8ffb2e449c6276 |
| fix/fhe-avatars | 9921e8693edb765111aaa44fbfc55f22d7872731 |
| feat/surround-containers | 623d52b715cb90b593f12de780ef90223d5999a0 |
| worktree-state-gates-json | c04c45c5c5774a163834302eaeb755d55bb7b309 |

The Media release also contains its batch, collection, player-stall, healing,
and final-test child branches. The older pre-public-scrub backup is deliberately
excluded from integration and publication.

## Conflict decisions

- Reading, Piano Learn, and FHE avatar changes were already present in newer
  implementations. Preserve current behavior, including scan authority,
  rejection handling, combined reading history, and synchronized avatar motion.
- Health keeps the current UI and numeric-edit API while adding atomic
  adjustment/restore commands. Quantity edits pin changed quantity fields against
  later enrichment; nutrient provenance remains nutrient-specific.
- School retains current keypad guards and receipt rendering. Bulk labels use
  printable subjects; telemetry logs actions/counts, never code digits.
- Fitness permanent exemptions remain non-subjects. Household challenges need a
  contributing governed subject; pure guest scoring remains neutral/standalone.
- Player keeps both the Media release ownership/recovery changes and birthday
  slideshow controls, overlays, cover art, and background music ducking.

## Verification

- Birthday release: 2,220 passed, 23 skipped across 226 files; production queue
  included all 13 explicitly tagged assets. Internal browser verification showed
  background music volume 0.075 during video, foreground volume 1, restoration to
  1 afterward, compact metadata, and hidden video progress chrome.
- Integration regressions: 126 passed across three focused files.
- Expanded integration: 2,163 passed across 84 files covering Fitness governance,
  School self-service/domain, Health adjustments, and state-gate persistence.
- Frontend production build passed.
- Final repository-wide gate and publication verification are recorded at release
  completion; the targeted runs above do not assert that every repository test passes.

No physical display activation or living-room remote-control action was used.
