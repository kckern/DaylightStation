package net.kckern.pianobridge;

import android.content.Context;
import android.util.Log;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * DeviceConfig — the baked-in BLE-MIDI device identities (assets/piano-devices.yml),
 * with an optional runtime override written to the app's files dir.
 *
 * Resolution order (later wins): bundled asset → filesDir/piano-devices.yml.
 * The override lets the pbctl CLI (POST /config) re-point the target piano
 * without rebuilding the APK.
 *
 * The parser handles the flat `key: value` subset the config uses — no nested
 * maps or block lists — which keeps it dependency-free (no snakeyaml) and
 * impossible to mis-parse. `#` comments and blank lines are ignored; values are
 * trimmed; inline `# …` trailing comments are stripped.
 */
public class DeviceConfig {

    private static final String TAG = "PianoBridge-Config";
    public static final String ASSET_NAME = "piano-devices.yml";
    public static final String OVERRIDE_NAME = "piano-devices.yml";

    private final Map<String, String> values = new LinkedHashMap<>();

    private DeviceConfig() { }

    /** Load baked defaults, then overlay any runtime override. */
    public static DeviceConfig load(Context ctx) {
        DeviceConfig cfg = new DeviceConfig();
        try (InputStream in = ctx.getAssets().open(ASSET_NAME)) {
            cfg.parseInto(in);
        } catch (IOException e) {
            Log.e(TAG, "failed to read bundled " + ASSET_NAME, e);
        }
        File override = overrideFile(ctx);
        if (override.exists()) {
            try (InputStream in = new java.io.FileInputStream(override)) {
                cfg.parseInto(in);
                Log.i(TAG, "applied runtime override " + override);
            } catch (IOException e) {
                Log.w(TAG, "failed to read override " + override, e);
            }
        }
        return cfg;
    }

    private void parseInto(InputStream in) throws IOException { parseFlat(in, values); }

    /** Parse the flat `key: value` subset into {@code out} (later keys win). Shared
     *  by config load AND the merging writeOverride so both use one parser. */
    static void parseFlat(InputStream in, Map<String, String> out) throws IOException {
        BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
        String line;
        while ((line = r.readLine()) != null) {
            String s = line.trim();
            if (s.isEmpty() || s.startsWith("#")) continue;
            int colon = s.indexOf(':');
            if (colon < 0) continue;
            String key = s.substring(0, colon).trim();
            String val = s.substring(colon + 1).trim();
            // Strip a trailing inline comment that is not part of a value with ':'.
            int hash = val.indexOf(" #");
            if (hash >= 0) val = val.substring(0, hash).trim();
            // Strip surrounding quotes if present.
            if (val.length() >= 2 && ((val.startsWith("\"") && val.endsWith("\""))
                    || (val.startsWith("'") && val.endsWith("'")))) {
                val = val.substring(1, val.length() - 1);
            }
            out.put(key, val);
        }
    }

    public static File overrideFile(Context ctx) {
        return new File(ctx.getFilesDir(), OVERRIDE_NAME);
    }

    /**
     * Persist a YAML override from POST /config — MERGING onto the existing override
     * rather than replacing it. A truncating write is what took the piano offline
     * (2026-07-15): the backend's MIDI-wake relay POSTs a lone
     * {@code fkbWakeSuppressUntilEpochMs}, and the old replace-semantics erased
     * {@code targetMac}, leaving the BLE-MIDI connector with nothing to dial. With a
     * merge, any partial POST only adds/updates its own keys; every sibling key
     * survives. Baked defaults remain the floor via {@link #load} for keys present in
     * neither the override nor the POST.
     */
    public static synchronized void writeOverride(Context ctx, String yaml) throws IOException {
        File f = overrideFile(ctx);
        String existing = "";
        if (f.exists()) {
            try (InputStream in = new java.io.FileInputStream(f)) {
                LinkedHashMap<String, String> cur = new LinkedHashMap<>();
                parseFlat(in, cur);
                existing = toYaml(cur);
            } catch (IOException e) {
                Log.w(TAG, "writeOverride: could not read existing override, merging onto empty", e);
            }
        }
        String merged = mergeOverride(existing, yaml);
        try (FileOutputStream out = new FileOutputStream(f)) {
            out.write(merged.getBytes(StandardCharsets.UTF_8));
        }
    }

    /**
     * Pure merge (JVM-testable, no Android deps): overlay {@code incoming} flat-YAML
     * keys onto {@code existing}, incoming winning, and return the full merged
     * flat-YAML. This is the guarantee that a partial POST /config can never drop a
     * sibling key like {@code targetMac}.
     */
    static String mergeOverride(String existing, String incoming) throws IOException {
        LinkedHashMap<String, String> merged = new LinkedHashMap<>();
        parseFlat(new java.io.ByteArrayInputStream(existing.getBytes(StandardCharsets.UTF_8)), merged);
        parseFlat(new java.io.ByteArrayInputStream(incoming.getBytes(StandardCharsets.UTF_8)), merged);
        return toYaml(merged);
    }

    private static String toYaml(Map<String, String> m) {
        StringBuilder sb = new StringBuilder();
        for (Map.Entry<String, String> e : m.entrySet()) {
            sb.append(e.getKey()).append(": ").append(e.getValue()).append('\n');
        }
        return sb.toString();
    }

    // --- typed accessors -------------------------------------------------

    public String midiServiceUuid() {
        return values.getOrDefault("midiServiceUuid", "03B80E5A-EDE8-4B33-A751-6CE34EC4C700");
    }

    /** Target MAC, normalized upper-case (Android returns upper-case addresses). */
    public String targetMac() { return norm(values.get("targetMac")); }

    public String targetName() { return values.getOrDefault("targetName", "jam-7e6"); }

    public Set<String> blocklistMacs() {
        String raw = values.get("blocklistMacs");
        if (raw == null || raw.trim().isEmpty()) return Collections.emptySet();
        Set<String> out = new HashSet<>();
        for (String part : raw.split(",")) {
            String m = norm(part);
            if (!m.isEmpty()) out.add(m);
        }
        return out;
    }

    public int scanTimeoutMs() { return intOr("scanTimeoutMs", 15000); }
    public int reconnectDelayMs() { return intOr("reconnectDelayMs", 3000); }
    public int controlPort() { return intOr("controlPort", 8770); }

    /** A2DP speaker target MAC (normalized upper-case), or "" if unset. */
    public String speakerMac() { return norm(values.get("speakerMac")); }
    public String speakerName() { return values.getOrDefault("speakerName", "Speaker"); }

    // --- FKB screen-wake (ScreenWaker): poke Fully Kiosk screenOn on a note so a
    //     played piano wakes a dark tablet. Set fkbPassword via `pbctl config set`.
    public boolean fkbWakeEnabled() { return boolOr("fkbWakeEnabled", true); }
    public String fkbHost() { return values.getOrDefault("fkbHost", "127.0.0.1"); }
    public int fkbPort() { return intOr("fkbPort", 2323); }
    public String fkbPassword() { return values.getOrDefault("fkbPassword", ""); }
    public int fkbWakeCooldownMs() { return intOr("fkbWakeCooldownMs", 8000); }

    // Wake gating the ScreenWaker evaluates at note time — ALL settable live via
    // `pbctl config set` (POST /config hot-reloads and rebuilds the ScreenWaker),
    // so wake policy can change forever with no APK rebuild and no ADB:
    //   fkbWakeQuietStart / fkbWakeQuietEnd : "HH:mm" LOCAL-time daily quiet window
    //     (both must be set; empty = no quiet window). Wraps past midnight, e.g.
    //     22:00→07:00 suppresses overnight wakes.
    //   fkbWakeSuppressUntilEpochMs : absolute epoch-millis; notes before it don't
    //     wake. The DS backend can implement ARBITRARY wake policy (any condition it
    //     wants) by computing a deadline and pushing this ONE key — no APK change.
    public String fkbWakeQuietStart() { return values.getOrDefault("fkbWakeQuietStart", ""); }
    public String fkbWakeQuietEnd() { return values.getOrDefault("fkbWakeQuietEnd", ""); }
    public long fkbWakeSuppressUntilMs() { return longOr("fkbWakeSuppressUntilEpochMs", 0L); }

    // --- Synthetic-touch un-throttle (TouchPulser + PianoTouchService): emit a
    //     tiny gesture while playing so the SM-T590 main-thread frame throttle
    //     stays lifted (BLE-MIDI is not "touch" to Android). All live-tunable via
    //     `pbctl config set` so we can A/B against perf.diagnostics with no rebuild.
    //     tapX/tapY/tapLen aim a micro-SWIPE (not a tap) at a corner dead zone; the
    //     swipe exceeds touch-slop so it never clicks whatever is under it.
    public boolean tapWakeEnabled() { return boolOr("tapWakeEnabled", true); }
    public int tapCadenceMs() { return intOr("tapCadenceMs", 700); }
    public int tapX() { return intOr("tapX", 3); }
    public int tapY() { return intOr("tapY", 6); }
    public int tapLen() { return intOr("tapLen", 34); }
    public int tapDurationMs() { return intOr("tapDurationMs", 20); }

    // --- KioskWatchdog (out-of-process WebView self-heal). All live-tunable via
    //     `pbctl config set` so thresholds and the recovery policy can change with no
    //     APK rebuild. The page POSTs a per-second heartbeat to /kiosk/beat; the
    //     watchdog runs an escalation ladder (touch-burst → reload → restartApp →
    //     rebootDevice) when the WebView stalls. reboot is capped + persisted so it
    //     can't boot-loop. Set watchdogRecoverEnabled=false for observe-only, or
    //     watchdogRebootEnabled=false to keep the soft rungs but never reboot.
    public boolean watchdogEnabled() { return boolOr("watchdogEnabled", true); }
    public boolean watchdogRecoverEnabled() { return boolOr("watchdogRecoverEnabled", true); }
    public boolean watchdogRebootEnabled() { return boolOr("watchdogRebootEnabled", true); }
    public int watchdogMinFps() { return intOr("watchdogMinFps", 12); }
    public int watchdogSustainSec() { return intOr("watchdogSustainSec", 5); }
    public int watchdogBeatTimeoutMs() { return intOr("watchdogBeatTimeoutMs", 12000); }
    public int watchdogGraceMs() { return intOr("watchdogGraceMs", 15000); }
    public long watchdogRebootMinGapMs() { return longOr("watchdogRebootMinGapMs", 3600000L); }
    public int watchdogLadderCooldownMs() { return intOr("watchdogLadderCooldownMs", 60000); }

    // --- KioskSettingsGuard (FKB kiosk-settings drift repair). A SEPARATE, slow
    //     concern from the page-health watchdog above: it asks "is FKB still
    //     configured as a kiosk?", not "is the WebView rendering?". 60s because drift
    //     is not urgent — the tablet sat with kioskMode=false for days before anyone
    //     noticed, so minutes of latency cost nothing.
    //
    //     installHold is the deploy-safety valve. Installing a new bridge APK REQUIRES
    //     kiosk mode OFF (FKB's kiosk mode auto-dismisses Android's install dialog →
    //     INSTALL_FAILED_ABORTED; see README deploy step 4), so the guard stands down
    //     for 15 min after a POST /update rather than fighting the deploy that ships it.
    //
    //     kioskSettingsDisarmUntilEpochMs is the hands-on escape hatch, set by
    //     POST /kiosk/settings/disarm and PERSISTED here on purpose: someone fiddling
    //     with the tablet will restart the bridge, and a disarm that evaporated on
    //     restart would be worse than none.
    public boolean watchdogKioskSettingsEnabled() { return boolOr("watchdogKioskSettingsEnabled", true); }
    public long watchdogKioskSettingsIntervalMs() { return longOr("watchdogKioskSettingsIntervalMs", 60000L); }
    public long watchdogKioskSettingsInstallHoldMs() { return longOr("watchdogKioskSettingsInstallHoldMs", 900000L); }
    public long kioskSettingsDisarmUntilMs() { return longOr("kioskSettingsDisarmUntilEpochMs", 0L); }

    // The install hold's DEADLINE, persisted because the APK install it guards against
    // STOPS this service — deploy step 7 then relaunches it (and says to repeat until
    // it answers). While this lived only in a PianoBridgeService field it reset to 0 on
    // every such restart and the suppression silently evaporated, so a retried or
    // second install landed with no hold at all (found deploying v22, 2026-07-21).
    // Storing the deadline rather than the request time means a later change to
    // watchdogKioskSettingsInstallHoldMs can't retroactively shorten a running hold.
    public long kioskSettingsInstallHoldUntilMs() { return longOr("kioskSettingsInstallHoldUntilEpochMs", 0L); }

    /** Raw key/value snapshot for the /config endpoint. */
    public Map<String, String> asMap() { return new LinkedHashMap<>(values); }

    private int intOr(String key, int def) {
        String v = values.get(key);
        if (v == null) return def;
        try { return Integer.parseInt(v.trim()); } catch (NumberFormatException e) { return def; }
    }

    private long longOr(String key, long def) {
        String v = values.get(key);
        if (v == null) return def;
        try { return Long.parseLong(v.trim()); } catch (NumberFormatException e) { return def; }
    }

    private boolean boolOr(String key, boolean def) {
        String v = values.get(key);
        if (v == null) return def;
        String s = v.trim().toLowerCase(java.util.Locale.US);
        if (s.equals("true") || s.equals("1") || s.equals("yes")) return true;
        if (s.equals("false") || s.equals("0") || s.equals("no")) return false;
        return def;
    }

    private static String norm(String mac) {
        return mac == null ? "" : mac.trim().toUpperCase(java.util.Locale.US);
    }
}
