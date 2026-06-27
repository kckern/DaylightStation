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

    private void parseInto(InputStream in) throws IOException {
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
            values.put(key, val);
        }
    }

    public static File overrideFile(Context ctx) {
        return new File(ctx.getFilesDir(), OVERRIDE_NAME);
    }

    /** Persist a raw YAML override (from pbctl POST /config). */
    public static void writeOverride(Context ctx, String yaml) throws IOException {
        File f = overrideFile(ctx);
        try (FileOutputStream out = new FileOutputStream(f)) {
            out.write(yaml.getBytes(StandardCharsets.UTF_8));
        }
    }

    // --- typed accessors -------------------------------------------------

    public String midiServiceUuid() {
        return values.getOrDefault("midiServiceUuid", "03B80E5A-EDE8-4B33-A751-6CE34EC4C700");
    }

    /** Target MAC, normalized upper-case (Android returns upper-case addresses). */
    public String targetMac() { return norm(values.get("targetMac")); }

    public String targetName() { return values.getOrDefault("targetName", "WIDI Master"); }

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

    /** Raw key/value snapshot for the /config endpoint. */
    public Map<String, String> asMap() { return new LinkedHashMap<>(values); }

    private int intOr(String key, int def) {
        String v = values.get(key);
        if (v == null) return def;
        try { return Integer.parseInt(v.trim()); } catch (NumberFormatException e) { return def; }
    }

    private static String norm(String mac) {
        return mac == null ? "" : mac.trim().toUpperCase(java.util.Locale.US);
    }
}
