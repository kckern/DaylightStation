package net.kckern.daylight.cap.webviewhost;

import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.display.DisplayManager;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.BatteryManager;
import android.view.Display;

import org.json.JSONException;
import org.json.JSONObject;

/** The device half of GET /kiosk/status. Thin reads of system services. */
final class DeviceFacts {
    private DeviceFacts() { }

    /**
     * The display's own power state. PowerManager.isInteractive() is not used: on the
     * Portal it stayed true on a dark panel (measured, portal-keys README "Display-state fix").
     */
    static boolean screenOn(Context c) {
        DisplayManager dm = (DisplayManager) c.getSystemService(Context.DISPLAY_SERVICE);
        Display d = dm == null ? null : dm.getDisplay(Display.DEFAULT_DISPLAY);
        return d != null && d.getState() == Display.STATE_ON;
    }

    @SuppressWarnings("deprecation")
    static void addTo(JSONObject o, Context c) throws JSONException {
        Intent battery = c.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        int level = -1;
        boolean plugged = false;
        if (battery != null) {
            int raw = battery.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
            int scale = battery.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
            if (raw >= 0 && scale > 0) level = raw * 100 / scale;
            plugged = battery.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0;
        }
        o.put("batteryLevel", level).put("plugged", plugged);

        ActivityManager am = (ActivityManager) c.getSystemService(Context.ACTIVITY_SERVICE);
        ActivityManager.MemoryInfo mem = new ActivityManager.MemoryInfo();
        if (am != null) am.getMemoryInfo(mem);
        o.put("ramFreeMb", mem.availMem / (1024 * 1024)).put("ramTotalMb", mem.totalMem / (1024 * 1024));

        WifiManager wm = (WifiManager) c.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        WifiInfo wifi = wm == null ? null : wm.getConnectionInfo();
        // The SSID is withheld from apps without location permission; null is the expected answer then.
        String ssid = wifi == null ? null : wifi.getSSID();
        if (ssid != null) {
            ssid = ssid.replace("\"", "");
            if (ssid.isEmpty() || ssid.equals("<unknown ssid>")) ssid = null;
        }
        boolean connected = wifi != null && wifi.getNetworkId() != -1;
        o.put("wifiSsid", ssid == null ? JSONObject.NULL : ssid);
        o.put("wifiSignalLevel", connected ? WifiManager.calculateSignalLevel(wifi.getRssi(), 5) : JSONObject.NULL);
        o.put("wifiRssi", connected ? wifi.getRssi() : JSONObject.NULL);
    }

    /** The same keys with no values, for when there is no Android context to read them from. */
    static void addUnknownTo(JSONObject o) throws JSONException {
        for (String key : new String[] { "batteryLevel", "plugged", "ramFreeMb", "ramTotalMb", "wifiSsid", "wifiSignalLevel", "wifiRssi" }) {
            o.put(key, JSONObject.NULL);
        }
    }
}
