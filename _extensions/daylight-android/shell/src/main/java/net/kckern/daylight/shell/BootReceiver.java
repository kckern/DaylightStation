package net.kckern.daylight.shell;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * BootReceiver starts the shell service after device boot, after the package is
 * replaced, and on the keep-alive alarm.
 *
 * MY_PACKAGE_REPLACED matters as much as BOOT_COMPLETED. PackageInstaller kills the
 * old process when it swaps the APK and starts nothing in its place, so without it
 * an update leaves the device with no service until someone opens the app by hand.
 *
 * It uses startForegroundService(), not startService(): a receiver runs in a
 * background context, and on Android 8+ startService() from the background throws
 * IllegalStateException. ShellService.onStartCommand() then calls startForeground()
 * within the 5s window.
 */
public class BootReceiver extends BroadcastReceiver {

    private static final String TAG = "Daylight";

    @Override
    public void onReceive(Context context, Intent intent) {
        final String action = intent == null ? null : intent.getAction();
        // Open the durable log first, so the notes below reach shell.log even when
        // no service has called install() yet in this process.
        ShellLog.install(context);
        if (ShellKeepAlive.ACTION.equals(action)) {
            // Keep-alive alarm: start only when the service is not already up, and
            // record it, because a revival is the event worth knowing about.
            if (!ShellService.isRunning()) {
                ShellLog.note("KEEPALIVE", "service not running, starting it");
                start(context, "KEEPALIVE");
            }
            return;
        }
        if (Intent.ACTION_BOOT_COMPLETED.equals(action)
                || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            Log.i(TAG, action + ": starting ShellService (foreground)");
            // Durable, because this is the record you want when a device comes back
            // from an update looking dead.
            ShellLog.note("BOOT", action + ": starting the shell service");
            start(context, "BOOT");
        }
    }

    /**
     * When targeting SDK 31+, Android refuses a foreground-service start from the
     * background except for a short list of exemptions. Boot and package-replaced
     * are exempt; the inexact keep-alive alarm is not. An uncaught refusal would
     * crash the process, so record it and let the next exempt trigger try again.
     */
    private static void start(Context context, String kind) {
        try {
            context.startForegroundService(new Intent(context, ShellService.class));
        } catch (RuntimeException e) {
            Log.w(TAG, "service start refused", e);
            ShellLog.note(kind, "service start refused: " + e);
        }
    }
}
