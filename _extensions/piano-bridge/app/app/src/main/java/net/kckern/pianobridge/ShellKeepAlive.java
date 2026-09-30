package net.kckern.pianobridge;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;

/**
 * ShellKeepAlive — alarms that bring the bridge service back without a human.
 *
 * Why (2026-09-30): the bridge died on 2026-09-27 and stayed dead for two days.
 * START_STICKY only restarts a service Android chose to kill, and its restart
 * backoff grows after repeated deaths. Two alarms close that gap:
 *
 *  - a repeating keep-alive every {@link #INTERVAL_MS}, which starts the service if
 *    it is not running (a no-op when it is), and
 *  - a one-shot a few seconds after an uncaught exception, set from the crash
 *    handler before the process dies.
 *
 * Alarms survive process death. They do NOT survive a force-stop: that clears
 * every alarm and blocks broadcasts until the app is launched explicitly. The
 * off-tablet PianoBridgeSupervisorService (DS backend) covers that case by
 * relaunching through Fully Kiosk, and the battery-optimization exemption
 * requested by MainActivity keeps Samsung's app sleeping from force-stopping it.
 */
final class ShellKeepAlive {

    static final String ACTION = "net.kckern.pianobridge.KEEPALIVE";
    static final long INTERVAL_MS = 5 * 60_000L;
    private static final int REQ_REPEATING = 31;
    private static final int REQ_SOON = 32;

    private ShellKeepAlive() { }

    /** Arm (or re-arm) the repeating keep-alive. Idempotent: same PendingIntent replaces. */
    static void schedule(Context ctx) {
        try {
            AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;
            am.setInexactRepeating(AlarmManager.ELAPSED_REALTIME_WAKEUP,
                    SystemClock.elapsedRealtime() + INTERVAL_MS, INTERVAL_MS, pending(ctx, REQ_REPEATING));
        } catch (Throwable t) {
            ShellLog.note("KEEPALIVE", "schedule failed: " + t.getMessage());
        }
    }

    /** One-shot restart {@code delayMs} from now. Called from the crash handler. */
    static void soon(Context ctx, long delayMs) {
        try {
            AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;
            am.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP,
                    SystemClock.elapsedRealtime() + delayMs, pending(ctx, REQ_SOON));
        } catch (Throwable ignored) { }
    }

    private static PendingIntent pending(Context ctx, int req) {
        Intent i = new Intent(ctx, BootReceiver.class).setAction(ACTION);
        return PendingIntent.getBroadcast(ctx, req, i, PendingIntent.FLAG_UPDATE_CURRENT);
    }
}
