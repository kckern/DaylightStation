package net.kckern.daylight.shellkit;

import android.content.Context;
import android.content.Intent;
import android.util.Log;

/** Start the shell service, which loads the payload. Safe to call when it is already running. */
public final class ShellStart {
    /** By name: a capability's shell half cannot reference the shell app module. */
    static final String SERVICE = "net.kckern.daylight.shell.ShellService";

    private static Boolean persistent;

    private ShellStart() { }

    /**
     * Whether this device keeps the shell service in the foreground (a kiosk) or starts it on demand
     * (the phone). Read once from the shell's own BuildConfig, by name, since a capability's shell
     * half cannot reference the shell module. Persistent when it cannot be read.
     */
    public static synchronized boolean persistent() {
        if (persistent == null) {
            try {
                persistent = (Boolean) Class.forName("net.kckern.daylight.shell.BuildConfig")
                        .getField("PERSISTENT_SERVICE").get(null);
            } catch (ReflectiveOperationException | RuntimeException unreadable) {
                persistent = Boolean.TRUE;
            }
        }
        return persistent;
    }

    /**
     * Keeps the shell (and its payload) up for a background job by binding to it. From
     * Android 12 a job's process is "in the background" and may not start a service
     * (BackgroundServiceStartNotAllowedException), but it may bind one: the bound service is
     * created and boots the payload, and lives until {@link #release}. Answers null when even
     * the bind was refused.
     */
    public static Object hold(Context context) {
        try {
            Intent intent = new Intent().setClassName(context, SERVICE);
            android.content.ServiceConnection connection = new android.content.ServiceConnection() {
                @Override public void onServiceConnected(android.content.ComponentName n, android.os.IBinder b) { }
                @Override public void onServiceDisconnected(android.content.ComponentName n) { }
            };
            return context.bindService(intent, connection, Context.BIND_AUTO_CREATE) ? connection : null;
        } catch (RuntimeException refused) {
            Log.w("Daylight", "shell service bind refused: " + refused);
            return null;
        }
    }

    /** Lets go of a {@link #hold}: the shell stops when nothing else keeps it. */
    public static void release(Context context, Object held) {
        if (!(held instanceof android.content.ServiceConnection)) return;
        try { context.unbindService((android.content.ServiceConnection) held); } catch (RuntimeException alreadyGone) { }
    }

    /**
     * @return false when Android refused the start. From Android 12 a foreground
     *         service cannot be started from the background, so a tile or a widget
     *         never calls this: it draws from SurfaceCache and sends a tap through
     *         the link activity, which is visible and may start the service.
     */
    public static boolean ensure(Context context) {
        try {
            Intent intent = new Intent().setClassName(context, SERVICE);
            // On demand (the phone): a plain start from a visible screen, with no foreground notice.
            if (persistent()) context.startForegroundService(intent); else context.startService(intent);
            return true;
        } catch (RuntimeException refused) {
            Log.w("Daylight", "shell service start refused: " + refused);
            return false;
        }
    }
}
