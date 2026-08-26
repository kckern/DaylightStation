# School Physical Learning Console — Deployment Runbook

**Status:** the subsystem is built and tested but ships **inert**. It does
nothing until `school.yml` opts in. This runbook is what turning it on requires.

Architecture: [`2026-07-27-school-physical-console-architecture.md`](../superpowers/specs/2026-07-27-school-physical-console-architecture.md).
Subsystem reference: [`docs/reference/school/README.md`](../reference/school/README.md).
Already deployed and something's broken? See the
[day-to-day operations runbook](./school/README.md), especially
[hardware-troubleshooting.md](./school/hardware-troubleshooting.md).

---

## 1. What "inert" means

`createSchoolLifecycle` returns `{ wired: false }` and logs
`school.lifecycle.unwired` with a reason unless `lifecycle.enabled` is exactly
`true`. While inert:

- no lifecycle routes are mounted;
- `handlesCode` is a constant `() => false`, so the barcode relay's `sch:` branch
  is provably a no-op and existing consumers (content, nutribot) are untouched;
- nothing is constructed, so a misconfigured deployment cannot half-start.

It also refuses to wire — deliberately — if the document renderer cannot be
loaded. Mounting routes that would fail at the moment a child scans a card is
worse than not mounting them.

---

## 2. Config

`data/household/config/school.yml`:

```yaml
lifecycle:
  enabled: true          # the master switch; nothing wires without it
  economy:
    enabled: false       # coins OFF by default — see §5 before enabling

# Test-only. Leave FALSE (or absent) on any real deployment: it exposes
# endpoints that fake scans and force printer faults.
virtualDevices: false

# Optional. Defaults to <dataDir>/content/assets
# assets:
#   dir: /some/other/path
```

**`school.yml` is boot-cached.** Editing it requires a container restart (or a
`reloadHouseholdAppConfig` call); nodemon users can touch a watched
`backend/**.mjs` file.

---

## 3. Data the console expects

| Path | Holds |
|---|---|
| `<dataDir>/content/school/{subject}/{work}/{units,documents,manifests}/*.yml` | the published catalog |
| `<dataDir>/content/school/{subject}/{work}/quizzes/…` | question banks (path-form ids, `quizzes/` elided) |
| `<dataDir>/content/assets/<ref>.svg` | artwork referenced by `asset` blocks |
| `<dataDir>/apps/school/{sessions,tokens,forms,assignments}/` | written at runtime |
| `<dataDir>/apps/school/captures/` | virtual-device output (test only) |

**Validate the catalog before every promotion**, and always with the render probe:

```bash
node cli/school.mjs catalog validate --render-probe
```

Exit 0 means promotable. The probe is not optional politeness — it is the only
gate that catches TeX a schema cannot see (a `\phantom` inside `\fbox`, an
undefined macro that would otherwise print as red text on a child's worksheet).

A sample four-unit course lives at `tests/_fixtures/school/curriculum/` and can
be copied as a starting point.

---

## 4. Hardware

| Device | Wiring | State |
|---|---|---|
| Kitchen laser printer | existing `devices.yml` `kitchen-printer`; raw port 9100 | ready |
| Thermal printer | `thermalPrinterRegistry`, resolved by location | ready |
| Barcode scanner | existing relay; the `sch:` branch runs first in `onScan` | ready |
| Playback (TV / headset) | `playbackAdapter` injected | **NOT WIRED** — see below |
| OMR reader | virtual only | hardware not assembled |

**Playback is the one real gap.** `playbackAdapter` is currently null for real
hardware: the playback-hub container is constructed after the school section in
`app.mjs`, and mapping a school target onto a screen versus a headset is its own
piece of work. With no adapter the media leg prints *"there is nowhere to play
this"* rather than failing silently, so a media unit is visibly unavailable
rather than mysteriously broken. Worksheet, OMR, and quiz units are unaffected.

**OMR** is protocol-solved but has no assembled reader and no card that fits it
(see `docs/reference/omr/README.md`). The grading path is exercised by a
virtual reader driving the renderer's real form map, so it is ready for hardware
whenever the hardware exists.

---

## 5. Before enabling coins

`lifecycle.economy.enabled: false` is the shipping default and should stay that
way until you have watched real sessions settle. When enabled:

- a unit's `reward.amount` is paid through `EconomyService.earn`, still bounded
  by the household `daily_cap`;
- payment is keyed on a deterministic outcome id (`out:{sessionId}`), and School
  checks its own `rewardTxn` record **before** calling earn — the economy's own
  replay guard only scans the current UTC day and would pay the same ref again
  tomorrow;
- a unit with `reward.requiresSignoff: true` passes and unlocks the next unit
  immediately, but the coins wait for a grown-up. Sign-off gates the payment,
  never the progression.

---

## 6. Smoke check after enabling

```bash
npm run school:smoke        # 23 checks; non-zero exit on failure
```

Then, on the real deployment, do one loop by hand: scan a personal card, confirm
an agenda prints naming the child and listing at least one action, scan an action,
confirm the worksheet prints with a real title in the header and a scannable code,
and scan that code to confirm it reprints. Anything that prints an empty box or a
raw slug is a defect, not a cosmetic issue — both were real bugs during the build.

---

## 7. Rollback

Set `lifecycle.enabled: false` and restart. The subsystem returns to inert; the
relay branch stops matching; runtime data under `apps/school/` is left in place
and is append-only, so re-enabling resumes rather than restarts.
