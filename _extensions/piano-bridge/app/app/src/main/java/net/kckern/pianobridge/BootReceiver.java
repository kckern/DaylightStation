package net.kckern.pianobridge;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * BootReceiver — relaunch the bridge service after device boot OR after the app
 * self-updates.
 *
 * MY_PACKAGE_REPLACED matters as much as BOOT_COMPLETED here. PackageInstaller kills
 * the old process when it swaps the APK and starts nothing in its place, so without
 * this the ADB-free self-update leaves the tablet with no bridge at all — no MIDI, no
 * screen-wake, no kiosk watchdog — until somebody physically taps the icon. That
 * defeats the entire "never needs USB/ADB again" premise, and it bit us installing
 * v26 on 2026-08-22.
 *
 * MUST use startForegroundService(), not startService(): a BOOT_COMPLETED receiver
 * runs in a background context, and on Android 8+ startService() from the background
 * throws IllegalStateException — which is exactly why the bridge was dead after a
 * reboot until something hand-launched it. startForegroundService() is the allowed
 * background-start path; PianoBridgeService.onStartCommand() then calls
 * startForeground() within the 5s window (it has no mic, so the Android-11
 * foreground-service restriction does not apply).
 */
public class BootReceiver extends BroadcastReceiver {

    private static final String TAG = "PianoBridge";

    @Override
    public void onReceive(Context context, Intent intent) {
        final String action = intent == null ? null : intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action)
                || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            Log.i(TAG, action + " — starting PianoBridgeService (foreground)");
            // Durable, because this is the record you want when the tablet comes back
            // from an update looking dead. Same reason the boot path is noted.
            CrashLog.note("BOOT", action + " — relaunching bridge service");
            Intent serviceIntent = new Intent(context, PianoBridgeService.class);
            context.startForegroundService(serviceIntent);
        }
    }
}
