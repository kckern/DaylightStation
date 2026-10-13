# Portal Keys APK rebuild — handoff to the Mac

**Status:** optional. Nothing is blocked on this.
**Why it exists:** two source changes are committed but have never been
compiled or installed, so the Portal runs an APK that predates both.

---

## Read this first: you probably don't need to do this today

This rebuild completes **one half of one feature** — suppressing the Portal's
*physical* volume buttons during a public-kiosk shutdown. It is not required by
anything currently failing or pending:

| Thing | Needs the rebuild? |
|---|---|
| `registryCompleteness` test | **No** — passing; `shutdown/config.yml` is provisioned |
| Silent-scan fix (F-1–F-4) | **No** — unrelated subsystem |
| Kiosk shutdown: screen blackout | **No** — works today |
| Kiosk shutdown: Home Assistant cue | **No** — works today |
| Kiosk shutdown: Portal *hardware* buttons | **Yes** — this is the only gap |

Until it ships, a shutdown blacks out the School screen and the piano tablet
and fires the HA cue; the Portal's physical volume keys keep working.

---

## What is unbuilt

Two changes ride together — building ships **both**, so verify both.

1. **`30f48f2af` (2026-08-24) — the lockdown control plane.**
   Added `lockdownToken` config + a `/lockdown` route to `ControlServer.java`,
   `Config.java`, `PortalKeysService.java`. The running APK has neither:

   ```
   $ node _extensions/portal-keys/pkctl.mjs config
   { "fkbHost": ..., "screenToggleEnabled": false, ..., "gateTokenSet": false }
                                      # ^ no lockdownToken key at all
   $ node _extensions/portal-keys/pkctl.mjs lockdown-token <secret>
   { "error": "unknown key: lockdownToken" }
   ```

   Device `uptime` reads ~36 days — it predates the 2026-08-24 commit.

2. **`ace5058c4` (2026-08-26) — `isPanelLit()`.**
   `PortalKeysService` reads `Display.getState() == STATE_ON` instead of
   `PowerManager.isInteractive()`, which on this panel does not track the
   backlight. Already documented in the portal-keys README under
   "UNBUILT CHANGE PENDING".

---

## Build (Mac)

Per the README's Build section. **Bump `versionCode` first** — currently `15`
in `_extensions/portal-keys/app/app/build.gradle`; `install -r` rejects a lower
one. Bump `versionName` too so `pkctl status` identifies the build.

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@11/libexec/openjdk.jdk/Contents/Home
GRADLE=~/.gradle/wrapper/dists/gradle-7.5.1-bin/*/gradle-7.5.1/bin/gradle
cd _extensions/portal-keys/app && $GRADLE :app:assembleDebug --no-daemon
```

APK → `app/app/build/outputs/apk/debug/app-debug.apk`.

> Not buildable on the prod host: no Android SDK and no `adb`, and the system
> JDK is 21 — too new for Gradle 7.5.1. Installing an SDK there was possible
> but not worth it for a change that has to be verified against the physical
> panel anyway.

## Install

**USB is required, at least once.** Checked 2026-08-26 from the prod host:
`10.0.0.92:5555` refuses the connection, so ADB-over-WiFi is not currently
listening on the Portal. Turning it on (`adb tcpip 5555`) itself requires an
already-authorized ADB session, so there is no way in over the network alone.

Plug into USB on the Mac and install directly:

```bash
adb devices                          # authorize the prompt on the panel if asked
adb install -r .../app-debug.apk
```

Optionally enable WiFi ADB while you are physically connected, so future
installs need no cable:

```bash
adb tcpip 5555
adb connect <portal-ip>:5555
```

The `AccessibilityService` grant survives an `install -r`. If it does not,
**append** to the enabled-services list — never overwrite; the Portal ships
three of its own and clobbering them breaks the panel (README has the command).

## After install

1. **Provision the token.** The secret already exists server-side, generated
   and written on 2026-08-26 to `household/auth/portal-keys-lockdown.yml`:

   ```bash
   SECRET=$(sudo docker exec daylight-station sh -c \
     "node -e \"const y=require('js-yaml');console.log(y.load(require('fs').readFileSync('data/household/auth/portal-keys-lockdown.yml','utf8')).token)\"")
   node _extensions/portal-keys/pkctl.mjs lockdown-token "$SECRET"
   ```

   Expect `✓ shutdown token provisioned`, and `lockdownTokenSet: true` in
   `pkctl config`.

2. **Restore the `portal_keys` block** in `household/shutdown/config.yml`. It is
   currently commented out, with the block ready to paste and the reason inline:

   ```yaml
   portal_keys:
     base_url: http://<portal-ip>:8771
     auth_ref: portal-keys-lockdown
   ```

   **Do not restore it before the APK is verified.** `ShutdownService#syncPortal`
   deliberately does not advance its signature on failure so the 5-second
   reconciler keeps retrying. Against a 404 that is a failed request plus a
   `shutdown.portal_sync_failed` warn **every 5 seconds, forever** — armed or
   not. With the block absent the adapter has no `baseUrl`, returns
   `{ok: false, skipped: true}` without throwing, and stays silent. This is why
   it was left out rather than wired up hopefully.

3. **Verify the `isPanelLit()` fix** on a dark panel: one volume press must
   WAKE it, not trigger the double-press sleep.

4. **Only then** re-enable the sleep gesture. It was set `false` on 2026-08-26
   as the interim mitigation:

   ```bash
   FKB_HOST=<portal-ip>:2323 node cli/fkb.cli.mjs keepawake   # wake locks FIRST
   node _extensions/portal-keys/pkctl.mjs preflight
   node _extensions/portal-keys/pkctl.mjs config set screenToggleEnabled true
   ```

   With the display off the Portal drops WiFi, taking FKB REST, `pkctl` and
   ADB-over-WiFi with it. Apply `keepawake` before enabling the gesture, not
   after.

## Verify the whole path

Scan the shutdown card (`04aa660fcb2a81`) at the study reader and confirm:
`shutdown.portal_synced` in the log store, the School screen and piano tablet
blacked out, the HA cue fired, and the Portal's physical volume keys inert.
Revoke early by deleting `household/shutdown/lockdown.yml` — that file is the
only authority on an active window, and its absence means nothing is armed.
