package net.kckern.daylight.cap.mediaservice.shell;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;

/**
 * Keeps the app alive when a Media3 1.1.1 controller trips its own consistency check while
 * merging a player update ({@code PlayerInfo.Builder.build} through {@code mergePlayerInfo}: a
 * position past the end of the timeline it merged with). Acceptance run on build 212: the
 * process died about a second after the network came back with a tap pending; it was not
 * reproduced again (about twenty tries), so the cause is not known. The check guards the
 * controller's own copy of the player's state, which is rebuilt by the next update, so the
 * failure is logged with its stack and the main loop resumes. Any other exception is rethrown
 * and crashes as before. Installed once, from the media service.
 */
final class MainLoopGuard {
    private static final String TAG = "Daylight-Media";
    private static boolean installed;
    static volatile int contained;

    private MainLoopGuard() { }

    /** The one failure that is contained: the controller merge assertion, by its own frames. */
    static boolean containable(Throwable t) {
        if (!(t instanceof IllegalStateException)) return false;
        boolean build = false, merge = false;
        for (StackTraceElement f : t.getStackTrace()) {
            String c = f.getClassName();
            if (c.startsWith("androidx.media3.session.PlayerInfo") && "build".equals(f.getMethodName())) build = true;
            if (c.equals("androidx.media3.session.MediaUtils") && "mergePlayerInfo".equals(f.getMethodName())) merge = true;
        }
        return build && merge;
    }

    /** Main thread, once: the loop is re-entered from a message, so a contained failure ends only that message. */
    static synchronized void install() {
        if (installed) return;
        installed = true;
        new Handler(Looper.getMainLooper()).post(() -> {
            while (true) {
                try {
                    Looper.loop();
                    return;
                } catch (Throwable t) {
                    if (!containable(t)) {
                        if (t instanceof Error) throw (Error) t;
                        throw (RuntimeException) t;
                    }
                    contained++;
                    Log.e(TAG, "a Media3 controller update was inconsistent; contained (" + contained + ")", t);
                }
            }
        });
    }
}
