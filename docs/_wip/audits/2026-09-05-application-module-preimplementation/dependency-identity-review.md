# Dependency identity and installation policy

Status: every package reached by the selected public/move closure is classified;
no prospective manifest, lockfile, or install has been changed.

The machine record covers 14 external packages and the owner-local `workspace:*`
facet edges. It distinguishes three categories:

- Identity-sensitive: React, Mantine/provider contexts, backend canvas, server
  timezone, FileIO/YAML/HTTP scope, and the server router must retain their
  reviewed instance boundaries.
- Explicitly separate: server/web/root `moment-timezone`, backend/root canvas,
  and backend/root Vitest test scopes must not be silently hoisted together.
- Ordinary direct dependencies: UUID, Axios, Tabler icons, and `date-fns` have
  an exact observed version and an owning facet. `date-fns` is deliberately
  made a Gratitude-web dependency rather than inherited from the current root.

The canvas manifest/install discrepancy is an implementation blocker: the
inspected backend instance is 3.1.0 while the current backend manifest range is
`^3.2.1`. A future lockfile/ABI decision must resolve that mismatch without
falling back to root canvas. Peer and Vite-dedupe proof for React/Mantine also
remains a candidate build gate. The extracted Gratitude factory intentionally
does not inherit the unrelated bootstrap `rss-parser` dependency.
