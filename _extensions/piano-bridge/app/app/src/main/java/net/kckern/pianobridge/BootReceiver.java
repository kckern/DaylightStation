package net.kckern.pianobridge;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * BootReceiver — relaunch the bridge service after device boot.
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
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            Log.i(TAG, "Boot completed — starting PianoBridgeService (foreground)");
            Intent serviceIntent = new Intent(context, PianoBridgeService.class);
            context.startForegroundService(serviceIntent);
        }
    }
}
