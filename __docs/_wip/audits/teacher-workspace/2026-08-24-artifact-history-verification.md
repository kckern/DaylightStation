# Teacher workspace artifact-history verification

The teacher dashboard and session-history routes have an isolated browser
contract in `tests/live/flow/school/teacher-workspace-contract.runtime.test.mjs`.
It runs Vite only; every API request is intercepted, so it must not start the
household backend or touch printers, scanners, or live data.

Run it with:

```sh
npm run test:teacher-ui
```

The contract covers two representative routes:

- `/school/teacher`: expanding Learner3’s daily record resolves the canonical
  session, course poster, subject identity, worksheet preview/PDF, and result
  receipt. It rejects the former printable-queue sentence, anonymous
  `assessment` rows, and raw `P044` labels.
- `/school/teacher/students/learner3/history/sessions/ses_a6NVUhN9`: renders the
  immutable historical session with its taxonomy and issued-material cards.
  It rejects developer-facing artifact-lineage terminology.

Screenshots are written alongside this note as `today-issued-artifacts.png`
and `session-inspector.png` for visual inspection. The production frontend
build and the focused `GetTeacherToday`, `GetTeacherSession`, router, and
teacher component tests remain separate required gates.
