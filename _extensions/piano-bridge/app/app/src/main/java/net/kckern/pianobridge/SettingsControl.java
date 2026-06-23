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
