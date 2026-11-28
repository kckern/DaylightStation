package net.kckern.daylight.cap.mediaservice.shell;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import net.kckern.daylight.shellkit.UiTelemetry;

import org.json.JSONObject;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.function.LongSupplier;

/**
 * A stopgap, not a fix. Media3 1.1.1 has a controller trip its own consistency check while
 * merging a player update ({@code PlayerInfo.Builder.build} through {@code mergePlayerInfo}: a
 * position past the end of the timeline it merged with). Acceptance run on build 212: the
 * process died about a second after the network came back with a tap pending; it did not repeat
 * in about twenty tries, and its cause is not known.
 *
 * <p>That one failure is contained: logged (and sent as the {@code media.controller.contained}
 * telemetry event), the screens' controllers are rebuilt through {@link #onContained}, and the
 * main loop resumes. More than three in ten seconds is a loop of failures, not a blip: it is
 * rethrown and the process crashes and restarts clean. Any other exception crashes as before.
 */
final class MainLoopGuard {
    private static final String TAG = "Daylight-Media";
    private static boolean installed;
    static volatile int contained;
    private static final Hooks HOOKS = new Hooks();

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

    /** More than {@link #MAX} contained failures within {@link #WINDOW_MS} are not contained. Clock-injected. */
    static final class Policy {
        static final int MAX = 3;
        static final long WINDOW_MS = 10_000;
        private final LongSupplier clock;
        private final Deque<Long> times = new ArrayDeque<>();

        Policy(LongSupplier clock) { this.clock = clock; }

        synchronized boolean allow() {
            long now = clock.getAsLong();
            while (!times.isEmpty() && now - times.peekFirst() > WINDOW_MS) times.pollFirst();
            times.addLast(now);
            return times.size() <= MAX;
        }
    }

    /** What screens that hold a MediaController register to have it rebuilt after a contained failure. */
    static final class Hooks {
        private final List<Runnable> list = new ArrayList<>();

        /** Returns the unregister. */
        synchronized Runnable add(Runnable hook) {
            list.add(hook);
            return () -> { synchronized (Hooks.this) { list.remove(hook); } };
        }

        /** In registration order; one that throws never stops the others. */
        void fire() {
            List<Runnable> copy;
            synchronized (this) { copy = new ArrayList<>(list); }
            for (Runnable r : copy) {
                try { r.run(); } catch (RuntimeException brokenHook) { /* the others still run */ }
            }
        }
    }

    /** A screen's rebuild of its controller; call the returned runnable in onDestroy. */
    static Runnable onContained(Runnable rebuild) { return HOOKS.add(rebuild); }

    /** The loop body: run the loop; a contained throw ends only the message that threw and the loop is re-entered. */
    static void drive(Runnable loop, Policy policy, java.util.function.Consumer<Throwable> contained) {
        while (true) {
            try {
                loop.run();
                return;
            } catch (Throwable t) {
                if (!containable(t) || !policy.allow()) {
                    if (t instanceof Error) throw (Error) t;
                    throw (RuntimeException) t;
                }
                contained.accept(t);
            }
        }
    }

    static synchronized boolean claimInstall() {
        if (installed) return false;
        installed = true;
        return true;
    }

    static synchronized void resetForTest() { installed = false; }

    /** Once, from the media service: the loop is re-entered from a message on the main thread. */
    static void install(Context context) {
        if (!claimInstall()) return;
        final Context app = context.getApplicationContext();
        final Policy policy = new Policy(android.os.SystemClock::elapsedRealtime);
        new Handler(Looper.getMainLooper()).post(() -> drive(Looper::loop, policy, t -> {
            contained++;
            Log.e(TAG, "a Media3 controller update was inconsistent; contained (" + contained + ")", t);
            try {
                StringBuilder top = new StringBuilder();
                StackTraceElement[] st = t.getStackTrace();
                for (int i = 0; i < st.length && i < 6; i++) top.append(st[i].getClassName()).append('.').append(st[i].getMethodName()).append(';');
                UiTelemetry.event(app, "Media", "media.controller.contained",
                        new JSONObject().put("count", contained).put("stack", top.toString()));
            } catch (Exception notSent) { /* the Log.e above is the record */ }
            // Screens rebuild their controllers: the stale one is what tripped.
            HOOKS.fire();
        }));
    }
}
