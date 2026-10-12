# Production smoke after application-module cutover

This is a small GET-only check, separate from the isolated 640-case suite. It
checks health, API ping, baked build commit, root HTML, and one root-declared
JavaScript asset. The optional Piano catalogs read the loaded local exercise
bank; no arbitrary route can be added on the command line.

After the command and target have been reviewed, run from the repository root:

```sh
node tests/readiness/application-modules/production-smoke.mjs \
  --origin <reviewed-origin> --expected-commit <full-commit-sha> \
  --output <new-private-receipt-file>
```

Only when Piano is configured and unauthenticated access is expected, add
`--catalogs piano-exercises,piano-programs`. An unavailable catalog or access
denial fails the check; it is not silently skipped. No Cookie or Authorization
header is sent, and the script does not accept credentials or arbitrary paths.
Requests run serially with no redirects, a five-second deadline and a 1 MiB cap
per body. Compressed responses are rejected to keep raw length checks precise.

The manifest records the source pins, safe route rationale and production
invariants. The receipt includes response headers, byte lengths and body hashes,
without retaining production response bodies. It proves only this finite smoke,
not complete data parity, provider connectivity, jobs, devices or browser flows.
The baked build marker must match the supplied commit; development markers fail.

Offline controls require no server:

```sh
node --test tests/readiness/application-modules/production-smoke-controls.test.mjs
```

`non-http-surface-census.json.gz` separately records source registration sites and
browser entrypoints. It identifies conditional/dynamic registrations and leaves
their live activation, job execution and behavioral parity explicitly unproved.

The five fixed GETs passed against historical live reference source `7d0ffd25`
and the current live reference source `bf35ca20` (image `2217a991`). Optional
catalogs were not requested. The current receipt hash is recorded in the
manifest. This validates the finite command against the reference and gives no
candidate or post-cutover acceptance credit.
