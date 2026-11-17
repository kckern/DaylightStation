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
    // A separate capability token for the safety service. It is deliberately
    // never returned by /status or /config, just like the FKB password.
    public static final String KEY_LOCKDOWN_TOKEN = "lockdownToken";
    private static final String KEY_LOCKDOWN_UNTIL = "lockdownUntil";
    private static final String KEY_LOCKDOWN_REVISION = "lockdownRevision";

    public static final String KEY_PAGE_MAINTENANCE_UNTIL="pageRecoveryMaintenanceUntil";
    private final SharedPreferences prefs;

    public Config(Context ctx) { this(ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)); }
    Config(SharedPreferences prefs) { this.prefs=prefs; }

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

    public String lockdownToken() { return prefs.getString(KEY_LOCKDOWN_TOKEN, ""); }

    /** A Long.MAX_VALUE deadline represents a fail-closed indefinite lock. */
    public boolean lockdownActive() {
        long until = prefs.getLong(KEY_LOCKDOWN_UNTIL, 0);
        return until == Long.MAX_VALUE || until > System.currentTimeMillis();
    }

    public long lockdownUntil() { return prefs.getLong(KEY_LOCKDOWN_UNTIL, 0); }

    public long lockdownRevision() { return prefs.getLong(KEY_LOCKDOWN_REVISION,0); }

    /** Commit both values together before acknowledging to the safety service. */
    public synchronized boolean applyLockdown(LockdownCommand command) {
        if (!command.canApply(lockdownRevision(),lockdownUntil())) return false;
        SharedPreferences.Editor update=prefs.edit().putLong(KEY_LOCKDOWN_UNTIL,command.deadline());
        if (command.revision!=null) update.putLong(KEY_LOCKDOWN_REVISION,command.revision);
        if (!update.commit()) throw new IllegalStateException("Lockdown persistence failed");
        return true;
    }

    /** -1 unknown, 0 explicitly cleared; deadlines expire to UNKNOWN, never automatic release. */
    public int pageMaintenance(long now) {
        long until=prefs.getLong(KEY_PAGE_MAINTENANCE_UNTIL,-1);
        long setAt=prefs.getLong("pageMaintenanceSetAt",-1);
        return until==0 ? 0 : (until>now && now>=setAt && until-setAt<=900000 ? 1 : -1);
    }
    public void setPageMaintenance(long until,long now) {
        if (until!=0 && (until<=now || until-now>900000)) throw new IllegalArgumentException("maintenance must be 0 or a future deadline within 15 minutes");
        if (!prefs.edit().putLong(KEY_PAGE_MAINTENANCE_UNTIL,until).putLong("pageMaintenanceSetAt",now).commit())
            throw new IllegalStateException("maintenance persistence failed");
    }

    /** One atomic preferences view prevents pairing a stale Stop flag with a new revision. */
    public String pageSafetySnapshot(Integer displayState,long now) throws org.json.JSONException {
        java.util.Map<String,?> values=prefs.getAll();
        long revision=values.get(KEY_LOCKDOWN_REVISION) instanceof Long?(Long)values.get(KEY_LOCKDOWN_REVISION):0;
        long until=values.get(KEY_LOCKDOWN_UNTIL) instanceof Long?(Long)values.get(KEY_LOCKDOWN_UNTIL):Long.MAX_VALUE;
        long maintenance=values.get(KEY_PAGE_MAINTENANCE_UNTIL) instanceof Long?(Long)values.get(KEY_PAGE_MAINTENANCE_UNTIL):-1;
        long setAt=values.get("pageMaintenanceSetAt") instanceof Long?(Long)values.get("pageMaintenanceSetAt"):-1;
        boolean maintenanceKnown=maintenance==0 || (maintenance>now && now>=setAt && maintenance-setAt<=900000);
        return new org.json.JSONObject().put("known",displayState!=null && (displayState==1 || displayState==2) && maintenanceKnown && revision>0)
            .put("expectedAwake",displayState!=null && displayState==2).put("stopped",until==Long.MAX_VALUE || until>now)
            .put("revision",revision).put("maintenance",maintenance!=0).toString();
    }

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
                + "\"gateHeartbeatMs\":" + gateHeartbeatMs() + ","
                + "\"lockdownTokenSet\":" + (!lockdownToken().isEmpty()) + ","
                + "\"lockdownProtocolVersion\":2,"
                + "\"lockdownRevision\":" + lockdownRevision() + ","
                + "\"lockdownActive\":" + lockdownActive() + ","
                + "\"lockdownUntil\":" + (lockdownUntil() > 0 && lockdownUntil() != Long.MAX_VALUE ? lockdownUntil() : "null")
                + "}";
    }
}
