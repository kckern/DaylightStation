# Non-HTTP source inventory

The tracked [census](../../tests/readiness/application-modules/non-http-surface-census.json.gz)
classifies every Git-tracked file under `backend`, `modules`, `capabilities`,
`frontend` and `_extensions` at its recorded source commit. It replaces the
earlier 31-file, 204-site targeted inventory. Every included file has its owner,
Git blob, SHA-256, parser status and registration/entrypoint sites. The complete
exclusion list records tests, generated output, vendor directories, documentation,
lockfiles and formats outside the source scanner. Symlinks remain explicit
boundaries rather than being followed outside the tracked tree.

JavaScript, TypeScript and JSX sites use syntax trees: event subscriptions and
publications, registration factories/interfaces/tables, timers/jobs, browser
roots/routes/widgets/lazy imports, UI event handlers, workers and transports.
Each site records its enclosing symbol, source position, literal or dynamic
argument, conditional context and unresolved status. Computed calls whose target
cannot be identified are retained. Package entry/command declarations and
non-JavaScript extension/firmware candidates remain explicitly unresolved lexical
sites. File-level hashes include files with no recognized sites.

Regenerate offline from a specific commit, from the repository root:

```sh
node tests/readiness/application-modules/build-non-http-census.mjs --controls
node tests/readiness/application-modules/build-non-http-census.mjs <commit> tests/readiness/application-modules/non-http-surface-census.json
```

The tracked census is lossless `non-http-surface-census.json.gz`; the generated
raw JSON remains available in this workspace. See the [artifact manifest](../../tests/readiness/application-modules/inventory-gzip-manifest.tsv)
for raw and compressed hashes and sizes. Inspect it with
`gzip -cd tests/readiness/application-modules/non-http-surface-census.json.gz | jq '…'`,
or restore the original pinned path with
`gzip -cd tests/readiness/application-modules/non-http-surface-census.json.gz > tests/readiness/application-modules/non-http-surface-census.json`.
After regeneration, recompress with `gzip -n -c` and refresh the manifest.

The scanner and parser hashes are recorded in the artifact. Regeneration reads
Git objects, not mutable application files, and never imports the app or starts
native services. Controls cover literals, dynamic arguments, conditional sites,
timers, lazy/browser entries, JSX handlers, computed targets, factory interfaces,
registration tables, comments/strings and malformed syntax.

File coverage is complete for the declared tracked roots and exclusion policy.
Semantic completeness remains unresolved for aliases, reflective registration,
native-language callbacks and configuration-selected activation. A site does not
prove that it executes, that its handler is installed, or that its external
protocol works. Paired native graph, browser, job and write/read receipts supply
their own bounded runtime evidence. This census grants no behavior credit and
does not establish the production method/template denominator. Physical MIDI,
the localhost 8770 bridge, cast and firmware/device protocols remain separate
verification boundaries.
