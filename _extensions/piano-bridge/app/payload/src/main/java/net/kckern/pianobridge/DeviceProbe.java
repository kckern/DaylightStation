package net.kckern.pianobridge;

import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.os.SystemClock;

import org.json.JSONObject;

/**
 * DeviceProbe — device health via Android framework APIs, not dumpsys.
 *
 * On this hardened Android 10 an untrusted_app is SELinux-denied `dumpsys battery`,
 * `/proc/stat`, and `/proc/loadavg`, so /info is built from APIs that DO work for a
 * normal app: ActivityManager.MemoryInfo, the sticky ACTION_BATTERY_CHANGED intent,
 * SystemClock uptime, and Build.* identity. This is the ADB-free substitute for the
 * `adb shell dumpsys battery|meminfo` calls.
 */
public final class DeviceProbe {

    private DeviceProbe() { }

    public static JSONObject info(Context ctx) {
        JSONObject o = new JSONObject();
        try {
            o.put("model", Build.MODEL);
            o.put("manufacturer", Build.MANUFACTURER);
            o.put("androidRelease", Build.VERSION.RELEASE);
            o.put("sdkInt", Build.VERSION.SDK_INT);
            o.put("uptimeMs", SystemClock.elapsedRealtime());
            o.put("pid", android.os.Process.myPid());

            // The OS's OWN power/thermal verdicts — what Chromium and Samsung's SSRM
            // actually react to, regardless of what the Settings.Global toggles read.
            // (2026-08-23: every visible power-save setting was 0 during a 3fps episode;
            // these two answer whether the OS still THINKS it is power-saving or hot.)
            android.os.PowerManager pm =
                    (android.os.PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                JSONObject pow = new JSONObject();
                pow.put("powerSaveMode", pm.isPowerSaveMode());
                if (Build.VERSION.SDK_INT >= 29) {
                    int ts = pm.getCurrentThermalStatus();
                    String name;
                    switch (ts) {
                        case android.os.PowerManager.THERMAL_STATUS_NONE:      name = "NONE"; break;
                        case android.os.PowerManager.THERMAL_STATUS_LIGHT:     name = "LIGHT"; break;
                        case android.os.PowerManager.THERMAL_STATUS_MODERATE:  name = "MODERATE"; break;
                        case android.os.PowerManager.THERMAL_STATUS_SEVERE:    name = "SEVERE"; break;
                        case android.os.PowerManager.THERMAL_STATUS_CRITICAL:  name = "CRITICAL"; break;
                        case android.os.PowerManager.THERMAL_STATUS_EMERGENCY: name = "EMERGENCY"; break;
                        case android.os.PowerManager.THERMAL_STATUS_SHUTDOWN:  name = "SHUTDOWN"; break;
                        default: name = "UNKNOWN(" + ts + ")";
                    }
                    pow.put("thermalStatus", name);
                }
                pow.put("locationPowerSaveMode", pm.getLocationPowerSaveMode());
                pow.put("sustainedPerfSupported", pm.isSustainedPerformanceModeSupported());
                pow.put("deviceIdleMode", pm.isDeviceIdleMode());
                pow.put("interactive", pm.isInteractive());
                o.put("power", pow);
            }

            ActivityManager am = (ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE);
            if (am != null) {
                ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
                am.getMemoryInfo(mi);
                JSONObject mem = new JSONObject();
                mem.put("availMb", mi.availMem / (1024 * 1024));
                mem.put("totalMb", mi.totalMem / (1024 * 1024));
                mem.put("thresholdMb", mi.threshold / (1024 * 1024));
                mem.put("lowMemory", mi.lowMemory);
                o.put("mem", mem);
            }

            Intent b = ctx.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
            if (b != null) {
                JSONObject bat = new JSONObject();
                int level = b.getIntExtra("level", -1);
                int scale = b.getIntExtra("scale", -1);
                bat.put("percent", (level >= 0 && scale > 0) ? Math.round(100f * level / scale) : -1);
                bat.put("temperatureC", b.getIntExtra("temperature", -1) / 10.0); // tenths °C
                bat.put("status", b.getIntExtra("status", -1));   // 2=charging 5=full
                bat.put("plugged", b.getIntExtra("plugged", -1)); // 1=AC 2=USB
                o.put("battery", bat);
            }

            String[] tasks = new java.io.File("/proc/self/task").list();
            o.put("bridgeThreads", tasks == null ? -1 : tasks.length);
            o.put("ok", true);
        } catch (Exception e) {
            try { o.put("ok", false).put("error", String.valueOf(e.getMessage())); } catch (Exception ignored) { }
        }
        return o;
    }
}
