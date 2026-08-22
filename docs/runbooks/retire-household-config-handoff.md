# Handoff: finish retiring `data/household/config/`

**For the prod agent.** Code is merged and pushed. Two phases remain, and they
must happen in this order on the prod host.

- **Merged to main:** `96e6866ad` (22 commits, 2026-08-22)
- **Design + plan:** `docs/_wip/plans/2026-08-21-retire-household-config-*.md`
- **The registry:** `shared/contracts/householdConfig.mjs`

---

## Read this before you touch anything

**The data tree is Dropbox-synced and shared with prod.** A file moved on any
machine reaches production *before* any code does. That single fact dictates the
whole order below: deploy first, move data second. Reversing it breaks prod for
the length of the deploy.

**Config is cached at boot.** `getHouseholdAppConfig` reads an in-memory snapshot
built once by `loadConfig()`. Editing YAML changes nothing until a restart or a
`reloadHouseholdAppConfig` call.

**Never start a second backend.** `node backend/index.js` is a live household
controller — a second instance makes real Home Assistant calls and fights the
first for device authority. Port isolation does not make it safe.

---

## What is already true (nothing to do)

Phase A/B/C shipped in `96e6866ad`. On the currently-deployed code:

- Every config reader **prefers** its new grouped path and **falls back** to
  `household/config/`. Nothing has moved, so every fallback is what actually
  resolves today. The app union was verified byte-identical at every commit.
- `household/school/surfaces/` and `household/auth/donow.yml` **already moved**
  (they were safe to move ahead of deploy — see the two fix notes below).
- `hardware/devices.yml` already carries a `midi-recorder` entry. Additive;
  nothing reads it until this deploy lands.

Baseline gates, all green at `96e6866ad`:

```
npm run test:refactor    ->  18 files, 146 tests passed
npm run audit:layers     ->  apps-no-config-internals      8 (baseline 8) ok
                             adapters-no-config-singleton  0 (baseline 0) ok
                             no-storage-paths              0 (baseline 0) ok
```

`audit:layers` **exits 1** on two PRE-EXISTING regressions unrelated to this work
(`apps-success-false` 60 vs 49, `domains-tojson` 74 vs 67). Judge by the three
lines above, not the exit code.

---

## Step 1 — Deploy `96e6866ad`

This is a behavior no-op by construction. Deploy normally.

### Verify before moving on

```bash
curl -s -X POST http://localhost:3111/api/v1/system/reload | jq -r '.reloaded[]' | sort > /tmp/before.txt
wc -l /tmp/before.txt        # expect 34
jq -e '.failed == []' <<<"$(curl -s -X POST http://localhost:3111/api/v1/system/reload)"
```

**Keep `/tmp/before.txt`.** Step 2 diffs against it. An app that disappears
between here and there is the exact silent-shrink failure this work exists to
prevent.

Also confirm the school fix took effect — it could not be verified before deploy:

```bash
curl -s https://logs.kckern.net/select/logsql/query \
  -d 'query=_msg:school.surfaces.profile.unresolved AND _time:24h | stats count() as n'
```
Pre-fix baseline was **29 per 24h**. Expect 0 — **but a quiet window is not
proof.** The Portal only emits this while actually requesting a surface, so
either wait a full 24h or load the Portal school surface deliberately and watch
for a fresh row.

---

## Step 2 — Move the data

Only after step 1 is deployed and verified.

```bash
cd /opt/Code/DaylightStation
node scripts/migrate-household-config.mjs              # DRY RUN — default
```

Expect **34 planned moves**, 9 "already migrated" notes, no `ABORT`. Read every
line. Then:

```bash
node scripts/migrate-household-config.mjs --apply
```

The script refuses to overwrite an existing destination, never deletes (retired
files go to `data/_deleteme/`), and runs the `finances -> finance` rename before
the file moves that land inside it.

### Verify immediately

```bash
# restart first — config is cached at boot
curl -s -X POST http://localhost:3111/api/v1/system/reload | jq -r '.reloaded[]' | sort > /tmp/after.txt
diff /tmp/before.txt /tmp/after.txt
```

**Expect exactly two removals: `jamcorder` and `chatbots`.** Both stop being app
configs by design. Any other difference — stop and investigate.

Then walk the surfaces that fail *silently*:

| Check | Why it matters |
|---|---|
| `GET /api/v1/media/config` returns a **non-empty** `browse` array | The media swap is a semantic inversion. An empty array means a consumer is reading the wrong file — it throws nothing. |
| Admin YAML browser: list, open, save one file per domain folder | A missing allowlist entry 403s with no error and no log. |
| Admin per-app editor: finance, media, entropy, piano | These 404 until this move lands; they should work after. |
| NFC tag scan round-trip | The trigger repository writes. Confirm the tag lands in `triggers/bindings/nfc/` and no `config/` reappears. |
| `node cli/school/omr.mjs`, `cli/plex-sync.cli.mjs`, `cli/school/certify.mjs` | Each has a legacy fallback that is now dead. |

### If it goes wrong

Every retired file is in `data/_deleteme/config-retired-<date>/`, and every moved
file is a plain `mv` — reversible by hand. The deployed code still reads the
legacy path as a fallback, so **moving files back restores the previous state
without a redeploy.** That is the rollback.

---

## Step 3 — Phase E: remove the fallbacks

Only after step 2 has run and prod has been healthy long enough that every host
has synced. **Do not collapse this into step 2** — that recreates the half-state
this migration exists to eliminate.

Write these two assertions FIRST and make them pass before deleting anything.
The legacy fallback resolves `config/<anything>`, so an app the registry forgot
stays invisible until the fallback goes away and then presents as an app that
vanished:

```javascript
it('every registered app config exists on disk at its registered path', …);
it('household/config/ holds no app config the registry does not know', …);
it('no colocated <subdir>/config.yml exists outside the registry', …);
```

Full text in the plan doc, "Task 17". Then remove the legacy branches from:

- `shared/contracts/householdConfig.mjs` — delete `legacyAppConfigRelPath`
- `ConfigService.#resolveHouseholdAppConfigPath` — the legacy branch
- `configLoader.loadHouseholdApps` — the `config/` scan, plus the fallbacks in
  `loadHouseholdIntegrations` and `loadHouseholdDevices`
- `artmodeConfig.mjs` / `loadArtCollections` — the second candidate
- `device.mjs:153`, `homeAutomation.mjs:278` — `|| loadFile('config/keyboard')`
- `YamlTriggerConfigRepository` — `LEGACY_TRIGGER_ROOT`
- `YamlConfigFileService` — `'household/config'` from `ALLOWED_DIRS`
- The CLI fallbacks in `cli/school/omr.mjs`, `cli/plex-sync.cli.mjs`,
  `cli/school/certify.mjs`, `cli/barcode-scan-sim.cli.mjs`

Also close the **`.yaml` gap** (plan Task 17b): `ALLOWED_FILES` derives entries by
appending a hardcoded `.yml`, while the registry documents callers resolving
`.yml` *or* `.yaml`. An app whose file lands as `.yaml` boots fine and 403s in the
admin browser — the same silent failure the derivation was built to kill. No such
file exists today.

Finally:

```bash
mv "$DAYLIGHT_BASE_PATH/data/household/config" \
   "$DAYLIGHT_BASE_PATH/data/_deleteme/config-retired-$(date +%Y%m%d)"
```

Move, do not delete. `_deleteme/` is emptied by hand.

---

## Two follow-ups that are NOT blockers

**DoNow `?token=` deprecation.** The approvals secret now lives in
`household/auth/donow.yml`. `readToken` prefers `Authorization: Bearer` (matched
case-insensitively) then the JSON body, and still accepts `?token=` while logging
`donow.approvals.token.query_deprecated`. To finish:

1. Update the HA automation to send the token in the JSON body
2. Confirm quiet: `query=_msg:donow.approvals.token.query_deprecated AND _time:24h`
3. Only then delete the `req.query?.token` branch and its test case

Approvals silently 401 if the code change lands before the HA edit — that is why
it is staged.

**Open-when-falsy posture.** `expectedToken` falsy means `approve`/`deny` take
**no auth**. Pre-existing and documented in `docs/reference/donow/README.md`, so a
failed auth read *opens* the endpoint rather than closing it. A
`donow.approvals.no-token` warn now fires at composition so the state is visible.
Deliberately unchanged — flag it to KC if a hard failure is wanted.

---

## Things that look like bugs but are not

- **`jamcorder` still appears** in `1_adapters/`, in log event names
  (`jamcorder.saved`, `jamcorder.harvest.done`, …), in the wire format
  (`identities.jamcorderName`), in the archive path `media/midi/piano/log/jamcorder/`,
  and as the harvester `serviceId`. All deliberate. The rename moved the vendor
  name out of `2_domains/` and `3_applications/` (now `midi`); an adapter is
  exactly where a vendor name belongs. **Do not rename the harvester `serviceId`** —
  it is persisted in `system/config/jobs.yml` and two `cron-runtime.yml` files, and
  changing it orphans the nightly 04:00 harvest.
- **The school authored catalog is empty.** `contentRoot` resolves to
  `content/school/learning-catalog`, which does not exist; the real tree is staged
  at `content/school/_inbox/learning-catalog`. Confirmed WIP by KC — deliberately
  not fixed here. Only the *surfaces* lookup was decoupled from it.
- **`config/feed`, `config/jobs`, `config/auth`, `config/domains`, `config/queries/*`**
  are user- or system-scoped, not household. They are unrelated to this migration.
- **`authConfigDefaults.mjs:22` `config: ['config/*']`** is an HTTP route glob, not
  a filesystem path.
