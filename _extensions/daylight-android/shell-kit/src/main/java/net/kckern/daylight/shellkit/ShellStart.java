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
