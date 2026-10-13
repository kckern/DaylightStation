# Contributor map

Most feature work belongs in `__app_modules/<app>/`. Each application owns the
surfaces it needs: `server/`, `browser/`, `cli/`, `portable/`, and `satellites/`.
Tests for that feature usually live beside its implementation.

| Root | Responsibility |
| --- | --- |
| `__app_modules/` | Application features, integrations, UI, commands, and owned satellites |
| `__capabilities/` | Shared features such as playback, content catalogs, printing, and device control |
| `__backend/` | Server entry point, system infrastructure, configuration, and installed composition |
| `frontend/` | Browser entry point, routing, application composition, and shared styles |
| `shared/` | Portable contracts and utilities |
| `cli/` | Stable command entry points; application commands forward to their owner |
| `tests/` | Shared test helpers, fixtures, harnesses, and cross-feature tests |
| `scripts/` | Development, build, and architecture checks |
| `docker/` | Production image and entry point |
| `_extensions/` | Remaining independent satellite source |
| `__docs/` | Configuration, architecture, feature references, and runbooks |

The double underscore identifies a developer-focused source or documentation
root. Runtime import aliases such as `#system/*` and `#backend/*` retain their
names; their package mappings point to the renamed directories.

Application owners expose reviewed entry points listed in
[`owner-entry-policy.mjs`](../../../scripts/owner-entry-policy.mjs). Code in one
owner uses those entries to reach another owner. Capabilities provide shared
behavior without depending on application modules. Server domain, application,
adapter, rendering, API, and composition boundaries remain enforced by the
architecture checks.

Root, frontend, and backend dependencies retain separate installations.
`npm run prepare` links each owner's server and browser dependencies to the
appropriate installation. `node scripts/setup-owner-dependencies.mjs --check`
verifies those links.

The application-module cutover is complete. Its preparation harnesses,
readiness inventories, and release-specific build switches have been retired.
Reusable HTTP test transports live in `tests/_lib/memory-http/`.

Personal data, authoring drafts, logs, coverage, and scratch captures stay out
of version control. `_deleteme/` is an ignored local quarantine.
