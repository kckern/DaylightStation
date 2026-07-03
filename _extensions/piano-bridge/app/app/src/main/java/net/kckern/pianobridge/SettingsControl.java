package net.kckern.pianobridge;

import android.content.Context;
import android.provider.Settings;

import org.json.JSONObject;

/**
 * SettingsControl — read/write Android settings via the framework API.
 *
 * The ADB-free replacement for `adb shell settings get/put`. That shell path is
 * SELinux-denied to an untrusted_app, but Settings.{Secure,Global,System}.putString
 * works directly because we hold WRITE_SECURE_SETTINGS (dev-granted once over USB).
 * Reads are unrestricted. Lets the kiosk/bridge keep e.g. location_mode=3 (needed
 * for BLE scans) or stay_on_while_plugged_in correct without ADB.
 */
public final class SettingsControl {

    private SettingsControl() { }

    public static JSONObject get(Context c, String ns, String key) {
        JSONObject o = new JSONObject();
        try {
            String v;
            switch (ns) {
                case "global": v = Settings.Global.getString(c.getContentResolver(), key); break;
                case "system": v = Settings.System.getString(c.getContentResolver(), key); break;
                default:       v = Settings.Secure.getString(c.getContentResolver(), key);
            }
            o.put("ok", true).put("ns", ns).put("key", key)
             .put("value", v == null ? JSONObject.NULL : v);
        } catch (Exception e) {
            try { o.put("ok", false).put("error", String.valueOf(e.getMessage())); } catch (Exception ignored) { }
        }
        return o;
    }

    /**
     * Enable an AccessibilityService of THIS app by writing the secure settings the
     * system observes — the ADB-free equivalent of
     * `settings put secure enabled_accessibility_services <component>` + `accessibility_enabled 1`.
     * Requires WRITE_SECURE_SETTINGS (dev-granted). Idempotent: appends the
     * component to the colon-separated list only if absent. Works on Android 10
     * (this device predates the 13+ "restricted setting" guard on sideloaded a11y).
     *
     * @param component flattened ComponentName, e.g. net.kckern.pianobridge/net.kckern.pianobridge.PianoTouchService
     */
    public static JSONObject enableAccessibilityService(Context c, String component) {
        JSONObject o = new JSONObject();
        try {
            String cur = Settings.Secure.getString(c.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
            boolean present = false;
            if (cur != null && !cur.isEmpty()) {
                for (String part : cur.split(":")) { if (part.equals(component)) { present = true; break; } }
            }
            if (!present) {
                String next = (cur == null || cur.isEmpty()) ? component : cur + ":" + component;
                Settings.Secure.putString(c.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES, next);
            }
            Settings.Secure.putInt(c.getContentResolver(), Settings.Secure.ACCESSIBILITY_ENABLED, 1);
            o.put("ok", true).put("component", component).put("wasAlreadyEnabled", present);
        } catch (Exception e) {
            try { o.put("ok", false).put("component", component).put("error", String.valueOf(e.getMessage())); } catch (Exception ignored) { }
        }
        return o;
    }

    public static JSONObject put(Context c, String ns, String key, String value) {
        JSONObject o = new JSONObject();
        try {
            boolean ok;
            switch (ns) {
                case "global": ok = Settings.Global.putString(c.getContentResolver(), key, value); break;
                case "system": ok = Settings.System.putString(c.getContentResolver(), key, value); break;
                default:       ok = Settings.Secure.putString(c.getContentResolver(), key, value);
            }
            o.put("ok", ok).put("ns", ns).put("key", key).put("value", value);
        } catch (Exception e) {
            try { o.put("ok", false).put("error", String.valueOf(e.getMessage())); } catch (Exception ignored) { }
        }
        return o;
    }
}
