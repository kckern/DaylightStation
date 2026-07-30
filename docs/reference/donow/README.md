# DoNow — Reference

**Design spec:** `docs/superpowers/specs/2026-07-30-household-donow-dispatch-design.md`

DoNow is the household's "start this, there, now" dispatch facade. A single
`DoNowService` sits in front of eight surfaces (TVs, the garage fitness kiosk,
the piano kiosk, printers, the school Portal, the headset playback hub) that
all answer the same question — *send this learner here right now* — without a
caller ever needing to know how any individual surface actually works. Every
`dispatch()` call resolves to exactly one of four outcomes (`dispatched`,
`pending_approval`, `denied`, `failed`), each carrying a human sentence the
caller's own surface (a printed slip, a UI toast) shows verbatim.

DoNow is household-level, not a School-only port: it mounts unconditionally,
independent of `school.yml`'s `lifecycle.enabled` gate. School is one consumer
of it, wired into the school lifecycle as a dependency, the same way any other
caller (a trigger, a cron job) would be.

## `donow.yml` (household app config)

Read once at startup via `configService.getHouseholdAppConfig(householdId,
'donow')` — a household with no file at all still gets a fully-functioning
DoNow with every surface degraded per-key, never a missing service.

| Key | Default | Meaning |
|---|---|---|
| `notifyService` | none | Dotted Home Assistant notify target (e.g. `notify.mobile_app_parent_phones`). A real `HaApprovalNotifier` is only constructed when this AND a `haGateway` are both present; either alone logs a warning and leaves pending requests un-notified (still pend, never notified). |
| `approvalsToken` | none (open) | Shared-secret token gating `POST /approvals/:id/approve` and `.../deny`. Falsy means those routes take no auth — the same posture the trigger router's `authenticate` guard takes elsewhere. |
| `pianoKioskDeviceParam` | `null` | The Piano Kiosk tablet's `?device=` localStorage identity string (NOT a `devices.yml` id — see the screensaver shared-deviceId lesson). Required for the `piano-kiosk` surface to actually reach a tablet; absent, dispatch degrades to `{dispatched: false}`. |
| `livingroomDeviceId` | `'livingroom-tv'` | The `devices.yml` id `WakeAndLoadService` targets for the `livingroom-tv` surface. |
| `thermalPrinterLocation` | none (registry default) | Which entry of the house `ThermalPrinterRegistry` the `thermal` surface resolves. Absent uses the registry's own default printer. |
| `approvalTtlSeconds` | `120` | How long a `pending_approval` request stays open before it reads as expired on the approvals queue. Also the window `DoNowApprovals#repend`'s fresh expiry reuses (same duration as the original request). |

## `school.yml` — `programs:` (surface programs)

A `school.yml` `programs:` entry registers one `SurfaceProgramLauncher` — the
generic `IProgramLauncher` for a config-driven "go do this daily thing on that
surface" program (PE in the garage today; anything else tomorrow), with zero
new code per program:

```yaml
programs:
  - id: pe-daily              # stable id; must not collide with a
                              # code-registered launcher id (language)
    label: 'P.E.'             # human label; defaults to id
    surface: garage-fitness   # a registered DoNow surface id
    action: { episodeId: 'plex:901' }   # surface-specific dispatch payload
    subject: skills           # the subject shelf this program's units live under
    locationHint: 'in the garage'       # what a child reads for "where do I go"
```

`locationHint` is the one field worth calling out: it is what a child's agenda
slip and dispatch receipt read ("Daily P.E. — in the garage", "Starting in the
garage — off you go."). It mirrors a `launch:` curriculum unit's own
`labelHint` — author-supplied, because the console cannot infer it from a
surface id. Left unset, the offer and slip fall back to a generic,
location-agnostic wording ("go do this", "Starting — off you go.") rather than
assuming every program is Portal-hosted — the language ladder is the one
program that legitimately always reads "on the Portal" (`LanguageProgramLauncher`
states that itself; it is never a caller-side default for any other launcher).

`launch()` calls `DoNowService.dispatch` (`requestedBy: 'school-program'`);
`status()` derives `doneToday` by reading the DoNow dispatch log for a row
carrying this program's own `programId` for the learner, on the current study
day (two UTC shards, filtered by the household's local 4am boundary).

## Wording conventions

Two grammar rules the surfaces and the service jointly own, both regressions
a past review caught:

- **Adapters return article-free, lowercase noun phrases** from `label()` —
  `'garage fitness kiosk'`, `'quiz on the Portal'`, `'living room TV'` — never
  `'The garage fitness kiosk'`. `DoNowService`'s own templates (`` `The
  ${label} is busy right now.` ``) own the single leading article; a
  self-capitalized label doubled up into "The The garage fitness kiosk is
  busy right now." on a child's printed slip. The one place a label starts a
  sentence on its own — `HaApprovalNotifier`'s HA push message — capitalizes
  it itself rather than assuming the label already does.
- **A pending slip is honest about whether anyone was actually notified.**
  `DoNowService#actPend`'s message reads "...we asked a grown-up" only when a
  notifier is configured AND its call succeeded that time; with no notifier
  wired, or a notifier call that threw, the slip reads "...ask a grown-up"
  instead (imperative, not a false claim of a push already sent). The request
  still pends either way — approval via the API/approvals queue remains
  possible — the wording is the only thing that changes.
