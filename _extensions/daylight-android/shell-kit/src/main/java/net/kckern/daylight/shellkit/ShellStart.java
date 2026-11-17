package net.kckern.daylight.shellkit;

import android.content.Context;
import android.content.Intent;
import android.util.Log;

/** Start the shell service, which loads the payload. Safe to call when it is already running. */
public final class ShellStart {
    /** By name: a capability's shell half cannot reference the shell app module. */
    static final String SERVICE = "net.kckern.daylight.shell.ShellService";

    private ShellStart() { }

    /**
     * @return false when Android refused the start. From Android 12 a foreground
     *         service cannot be started from the background, so a tile or a widget
     *         never calls this: it draws from SurfaceCache and sends a tap through
     *         the link activity, which is visible and may start the service.
     */
    public static boolean ensure(Context context) {
        try {
            context.startForegroundService(new Intent().setClassName(context, SERVICE));
            return true;
        } catch (RuntimeException refused) {
            Log.w("Daylight", "shell service start refused: " + refused);
            return false;
        }
    }
}
