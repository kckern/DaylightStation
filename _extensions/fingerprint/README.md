# `_extensions/fingerprint` — on-box fingerprint helper (garage HOST)

Host-side helper for the fingerprint action-unlock feature. Runs on the **garage box host**
(Linux Mint), where `fprintd` + `libfprint` (driver `uru4000`, supports the DigitalPersona
U.are.U 4500) and the USB reader live — NOT inside the `daylight-fitness` container (which
has no `fprintd`).

## Responsibilities (planned)

- **Enrollment CLI** (Task 1.3): capture a finger via libfprint, store the template by uuid
  under `/var/lib/daylight-unlock/<uuid>.tpl`, and append
  `{ id, finger, enrolled }` to `data/users/<user>/profile.yml` → `identities.fingerprints[]`.
- **Identify helper** (Task 1.4): given candidate uuids, capture ONE finger placement and
  identify against that gallery; return the matched uuid → username. Mechanism (python-gi
  `FPrint` vs a small C helper) is decided by the Phase 0 spike.
- **Container ⇄ host bridge** (Task 1.5): the unlock request arrives at the `daylight-fitness`
  container over the backend WebSocket; the container calls this host helper (localhost) to
  run identify. Until hardware exists, the container's `FINGERPRINT_SIM` path
  (`_extensions/fitness/`, `simulate.mjs`) stands in for identify.

## Built so far

- `src/profileStore.mjs` — pure helpers (`addFingerprintEntry`, `collectGalleryUuids`) used by
  the enroll CLI; unit-tested in `test/profileStore.test.mjs` (`node --test`).

Templates never leave the box; only uuids appear in `profile.yml`. See the design/plan:
`docs/_wip/plans/2026-06-17-fingerprint-unlock-*.md` and the simulation runbook
`docs/runbooks/fingerprint-unlock-simulation.md`.
