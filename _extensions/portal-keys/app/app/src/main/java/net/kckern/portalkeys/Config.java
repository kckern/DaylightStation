package net.kckern.portalkeys;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * On-device persisted config, settable over the control plane (pkctl) so a running
 * panel can be retuned without a reinstall.
 *
 * Deliberately NOT holding a copy of anything that lives in devices.yml as the SSOT —
 * fkbPassword is the one secret here and it is pushed in, never checked into the repo.
 *
 * Piano-bridge's hard lesson (see reference_piano_bridge_config_clobber_root_cause):
 * a partial write of a config blob wiped the target device address and bricked the
 * bridge. So every setter here writes ONE key, and there is no "replace the whole
 * config" path at all.
 */
public class Config {

    private static final String PREFS = "portalkeys";

    public static final String KEY_FKB_HOST = "fkbHost";
    public static final String KEY_FKB_PASSWORD = "fkbPassword";
    public static final String KEY_SCREEN_TOGGLE_ENABLED = "screenToggleEnabled";
    public static final String KEY_CONSUME_VOLUME = "consumeVolume";
    public static final String KEY_DOUBLE_PRESS_MS = "doublePressMs";
    public static final String KEY_BLOCK_CONTROL_CENTER = "blockControlCenter";
    // Presence gate. NOTE: deliberately NO device list here — the backend owns
    // which devices matter and what their absence means. Two copies of that
    // list is how a replaced headset strands the gate.
    public static final String KEY_GATE_ENDPOINT = "gateEndpoint";
    public static final String KEY_GATE_TOKEN = "gateToken";
    public static final String KEY_GATE_HEARTBEAT_MS = "gateHeartbeatMs";

    private final SharedPreferences prefs;

    public Config(Context ctx) {
        this.prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** FKB REST endpoint on this same device. Loopback by default. */
    public String fkbHost() {
        return prefs.getString(KEY_FKB_HOST, "127.0.0.1:2323");
    }

    /** Empty until pushed in via pkctl. Screen toggle is inert without it. */
    public String fkbPassword() {
        return prefs.getString(KEY_FKB_PASSWORD, "");
    }

    /**
     * Double-press VOLUME_DOWN sleeps the display; any volume key wakes it.
     *
     * DEFAULTS TO FALSE, deliberately. With the display off the Portal drops WiFi, taking
     * FKB REST, pkctl and ADB-over-WiFi with it — a panel that sleeps before
     * `fkb.cli.mjs keepawake` has been applied is unreachable until someone physically
     * presses a button. That happened on 2026-07-21 and ended the session's ability to
     * verify anything.
     *
     * So a fresh install can never strand a panel. Turn it on only after keepawake:
     *   node _extensions/portal-keys/pkctl.mjs preflight     # verifies the wake locks
     *   node _extensions/portal-keys/pkctl.mjs config set screenToggleEnabled true
     */
    public boolean screenToggleEnabled() {
        return prefs.getBoolean(KEY_SCREEN_TOGGLE_ENABLED, false);
    }

    /**
     * Whether volume keys are consumed (true) or passed to Android's STREAM_MUSIC
     * (false). Consuming is the point of the SPA-owns-volume design, but leaving a
     * switch means a broken SPA never costs you the ability to change the volume.
     */
    public boolean consumeVolume() {
        return prefs.getBoolean(KEY_CONSUME_VOLUME, true);
    }

    /** Max gap between two VOLUME_DOWN presses to count as a double-press. */
    public int doublePressMs() {
        return prefs.getInt(KEY_DOUBLE_PRESS_MS, 450);
    }

    /**
     * Auto-dismiss Portal's swipe-up Control Center (volume/brightness/bluetooth).
     *
     * There is no way to stop it opening — see PortalKeysService.onAccessibilityEvent for
     * everything that was ruled out on hardware. All we can do is close it the instant it
     * appears. Defaults TRUE: on a kiosk the panel is never wanted, and unlike
     * screenToggleEnabled a wrong value here cannot strand the panel.
     *
     * Escape hatch, no reinstall:
     *   node _extensions/portal-keys/pkctl.mjs config set blockControlCenter false
     */
    public boolean blockControlCenter() {
        return prefs.getBoolean(KEY_BLOCK_CONTROL_CENTER, true);
    }

    public void setInt(String key, int value) {
        prefs.edit().putInt(key, value).apply();
    }

    public void setString(String key, String value) {
        prefs.edit().putString(key, value).apply();
    }

    public void setBoolean(String key, boolean value) {
        prefs.edit().putBoolean(key, value).apply();
    }

    /** Backend presence endpoint. Empty = reporting disabled. */
    public String gateEndpoint() { return prefs.getString(KEY_GATE_ENDPOINT, ""); }

    public String gateToken() { return prefs.getString(KEY_GATE_TOKEN, ""); }

    /** Heartbeat cadence. The backend's TTL must exceed this or the gate flaps. */
    public int gateHeartbeatMs() { return prefs.getInt(KEY_GATE_HEARTBEAT_MS, 60000); }

    /** Redacted view for pkctl status — never emits the password. */
    public String toJsonRedacted() {
        return "{"
                + "\"fkbHost\":\"" + Json.escape(fkbHost()) + "\","
                + "\"fkbPasswordSet\":" + (!fkbPassword().isEmpty()) + ","
                + "\"screenToggleEnabled\":" + screenToggleEnabled() + ","
                + "\"consumeVolume\":" + consumeVolume() + ","
                + "\"doublePressMs\":" + doublePressMs() + ","
                + "\"blockControlCenter\":" + blockControlCenter() + ","
                + "\"gateEndpoint\":\"" + Json.escape(gateEndpoint()) + "\","
                + "\"gateTokenSet\":" + (!gateToken().isEmpty()) + ","
                + "\"gateHeartbeatMs\":" + gateHeartbeatMs()
                + "}";
    }
}
