package net.kckern.daylight.shellkit;

import android.app.Activity;
import android.app.Application;
import android.content.Context;
import android.graphics.Rect;
import android.net.ConnectivityManager;
import android.net.Network;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.ViewGroup;
import android.view.Window;

import net.kckern.daylight.api.PayloadPort;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * What a person does on the phone's native screens, for the household log store: every
 * tap and swipe (which screen, which control), each screen shown and for how long, and
 * the named events a screen adds ({@link #event}). Installed once by any native screen
 * ({@link #install}); from then on every activity of the app is watched, so a new
 * screen is covered without a line of its own.
 *
 * <p>Offline first. Each event goes to disk the moment it happens (TelemetryStore) and
 * is sent later, in order, in batches, through the payload's "telemetry" port to
 * {@code POST /api/v1/client-log}; a batch is deleted only once the backend accepted
 * it. Sending is tried when a screen goes to the background, every 30 s while one is
 * shown (backing off to 5 min while it fails), and when a network comes back. Nothing
 * waits on it and nothing fails because of it.
 *
 * <p>A control is named by its telemetry tag ({@link #tag}) when it has one, else by its
 * accessibility description, else its id; a screen that shows titles in descriptions
 * tags those controls, so titles stay out of the log.
 */
public final class UiTelemetry {
    private static final String TAG = "Daylight-Telemetry";
    public static final String PORT = "telemetry";
    private static final long FLUSH_MS = 30_000, MAX_BACKOFF_MS = 5 * 60_000;
    private static final int MAX_LABEL = 60;

    private static volatile UiTelemetry instance;

    private final Context app;
    private final TelemetryStore store;
    /** Sends in a row that left batches; on disk, so a restarted process keeps the wait (TelemetryBackoff). */
    private final TelemetryBackoff backoff;
    private final String session = UUID.randomUUID().toString().substring(0, 8);
    private final ExecutorService io = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "Daylight-telemetry");
        t.setDaemon(true);
        return t;
    });
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable tick = this::tick;
    private volatile int started;
    private long backoffMs = FLUSH_MS;

    private UiTelemetry(Context context) {
        app = context.getApplicationContext();
        File dir = new File(app.getFilesDir(), "telemetry");
        store = new TelemetryStore(dir);
        backoff = new TelemetryBackoff(new File(dir, "backoff.txt"));
    }

    /** Watch this app's activities from now on (idempotent), this one included. */
    public static void install(Activity activity) {
        get(activity).hook(activity);
    }

    private static UiTelemetry get(Context context) {
        UiTelemetry t = instance;
        if (t != null) return t;
        synchronized (UiTelemetry.class) {
            if (instance == null) {
                instance = new UiTelemetry(context);
                Context app = context.getApplicationContext();
                if (app instanceof Application) instance.listen((Application) app);
            }
            return instance;
        }
    }

    /**
     * For the background job (no screen open): send what waits, starting the payload if
     * needed, then {@code done} with whether anything is still waiting.
     */
    public static void flushInBackground(Context context, java.util.function.Consumer<Boolean> done) {
        get(context).flush(true, done);
    }

    /**
     * The job that sends held batches once a network is there, with the app closed: a
     * component of the phone build (widgets), looked up by name so a build without it
     * just sends the next time a screen opens.
     */
    static final String JOB_CLASS = "net.kckern.daylight.cap.widgets.shell.TelemetryJob";
    private static final int JOB_ID = 7102;

    /** After a failed send: the job after the count's wait. {@code afterJobRun}: the job itself is asking again. */
    private void scheduleJob(boolean afterJobRun) { scheduleJob(TelemetrySchedule.retryMs(backoff.failedRuns()), afterJobRun); }

    private void scheduleJob(long wait, boolean afterJobRun) {
        try {
            android.content.ComponentName job = new android.content.ComponentName(app, JOB_CLASS);
            app.getPackageManager().getServiceInfo(job, 0);
            android.app.job.JobScheduler scheduler = app.getSystemService(android.app.job.JobScheduler.class);
            if (scheduler == null) return;
            android.app.job.JobInfo pending = scheduler.getPendingJob(JOB_ID);
            if (!TelemetrySchedule.replacePending(pending == null ? -1 : pending.getMinLatencyMillis(), wait, afterJobRun)) return;
            scheduler.schedule(new android.app.job.JobInfo.Builder(JOB_ID, job)
                    .setRequiredNetworkType(android.app.job.JobInfo.NETWORK_TYPE_ANY)
                    .setMinimumLatency(wait)
                    .setBackoffCriteria(wait, android.app.job.JobInfo.BACKOFF_POLICY_LINEAR)
                    .build());
            Log.i(TAG, "telemetry job scheduled in " + (wait / 1000) + " s (failed runs " + backoff.failedRuns() + ")");
        } catch (Exception notInThisBuild) {
            // No job: the batches go when a screen next opens or a network returns.
        }
    }

    /** A named event from a screen ("now-playing", "stage", {to: "lyrics"}). Ignored before install. */
    public static void event(String screen, String name, JSONObject data) {
        UiTelemetry t = instance;
        if (t != null) t.record(name, screen, data);
    }

    /** The same, from a service with no screen open yet (the media service's queue): recorded, sent later. */
    public static void event(Context context, String screen, String name, JSONObject data) {
        get(context).record(name, screen, data);
    }

    /** Names a control for telemetry, in place of its accessibility description. */
    public static void tag(View v, String control) { v.setTag(R.id.daylight_telemetry, control); }

    // ── lifecycle ────────────────────────────────────────────────────────────

    // ACCESS_NETWORK_STATE comes from the base shell of every build that uses shell-kit;
    // without it the callback throws and is caught below (sending stays on the timer).
    @android.annotation.SuppressLint("MissingPermission")
    private void listen(Application application) {
        application.registerActivityLifecycleCallbacks(new Application.ActivityLifecycleCallbacks() {
            @Override public void onActivityCreated(Activity a, Bundle saved) { hook(a); }
            @Override public void onActivityStarted(Activity a) {
                a.getWindow().getDecorView().setTag(R.id.daylight_telemetry_shown, SystemClock.elapsedRealtime());
                record("ui.screen.shown", screen(a), null);
                if (started++ == 0) { backoffMs = FLUSH_MS; main.removeCallbacks(tick); main.postDelayed(tick, FLUSH_MS); }
            }
            @Override public void onActivityStopped(Activity a) {
                Object at = a.getWindow().getDecorView().getTag(R.id.daylight_telemetry_shown);
                JSONObject d = new JSONObject();
                try { if (at instanceof Long) d.put("visibleMs", SystemClock.elapsedRealtime() - (Long) at); } catch (Exception ignored) { }
                record("ui.screen.hidden", screen(a), d);
                if (--started <= 0) { started = 0; main.removeCallbacks(tick); }
                // The last screen closed: send now, and whatever is left goes to the job.
                flush(false, null);
            }
            @Override public void onActivityResumed(Activity a) { }
            @Override public void onActivityPaused(Activity a) { }
            @Override public void onActivitySaveInstanceState(Activity a, Bundle out) { }
            @Override public void onActivityDestroyed(Activity a) { }
        });
        // Back online: send what waited. The phone build holds ACCESS_NETWORK_STATE; a
        // build without it just sends on the timer and when a screen closes.
        try {
            ConnectivityManager cm = app.getSystemService(ConnectivityManager.class);
            if (cm != null) cm.registerDefaultNetworkCallback(new ConnectivityManager.NetworkCallback() {
                @Override public void onAvailable(Network network) {
                    backoffMs = FLUSH_MS;
                    // Held batches with no screen: the job, within seconds (it holds the shell; this flush cannot start it).
                    flush(false, left -> { if (left && started == 0) scheduleJob(TelemetrySchedule.NETWORK_BACK_MS, false); });
                }
            });
        } catch (RuntimeException noPermission) {
            Log.i(TAG, "no network callback: " + noPermission.getClass().getSimpleName());
        }
        flush();
    }

    private void tick() {
        flush();
        if (started > 0) main.postDelayed(tick, backoffMs);
    }

    private static String screen(Activity a) {
        String n = a.getClass().getSimpleName();
        return n.endsWith("Activity") ? n.substring(0, n.length() - "Activity".length()) : n;
    }

    // ── taps ─────────────────────────────────────────────────────────────────

    /** Wraps the window's callback once, to see every touch before the screen does. */
    private void hook(Activity a) {
        Window w = a.getWindow();
        if (w == null) return;
        Window.Callback original = w.getCallback();
        if (original == null || Proxy.isProxyClass(original.getClass())) return;
        final String screen = screen(a);
        final int slop = ViewConfiguration.get(a).getScaledTouchSlop();
        final float[] down = new float[2];
        final View[] target = new View[1];
        w.setCallback((Window.Callback) Proxy.newProxyInstance(Window.Callback.class.getClassLoader(),
                new Class<?>[] { Window.Callback.class }, (proxy, method, args) -> {
                    if ("dispatchTouchEvent".equals(method.getName()) && args != null && args[0] instanceof MotionEvent) {
                        try { touch(w, screen, slop, down, target, (MotionEvent) args[0]); }
                        catch (RuntimeException never) { /* telemetry never breaks a screen */ }
                    }
                    try { return method.invoke(original, args); }
                    catch (InvocationTargetException e) { throw e.getCause(); }
                }));
    }

    private void touch(Window w, String screen, int slop, float[] down, View[] target, MotionEvent e) {
        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                down[0] = e.getRawX();
                down[1] = e.getRawY();
                target[0] = hit(w.getDecorView(), (int) e.getRawX(), (int) e.getRawY());
                break;
            case MotionEvent.ACTION_UP: {
                float dx = e.getRawX() - down[0], dy = e.getRawY() - down[1];
                boolean tap = Math.abs(dx) < slop && Math.abs(dy) < slop;
                JSONObject d = new JSONObject();
                try {
                    d.put("control", label(target[0]));
                    if (!tap) d.put("direction", Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? "left" : "right") : (dy < 0 ? "up" : "down"));
                } catch (Exception ignored) { }
                record(tap ? "ui.tap" : "ui.swipe", screen, d);
                target[0] = null;
                break;
            }
            default:
                break;
        }
    }

    /** The deepest shown, enabled view under the point that takes touches. */
    static View hit(View v, int x, int y) {
        if (v == null || !v.isShown()) return null;
        Rect r = new Rect();
        if (!v.getGlobalVisibleRect(r) || !r.contains(x, y)) return null;
        if (v instanceof ViewGroup) {
            ViewGroup g = (ViewGroup) v;
            for (int i = g.getChildCount() - 1; i >= 0; i--) {
                View found = hit(g.getChildAt(i), x, y);
                if (found != null) return found;
            }
        }
        return v.isClickable() || v.isLongClickable() || v.hasOnClickListeners() ? v : null;
    }

    static String label(View v) {
        if (v == null) return "(none)";
        Object tag = v.getTag(R.id.daylight_telemetry);
        String out;
        if (tag instanceof String) out = (String) tag;
        else if (v.getContentDescription() != null && v.getContentDescription().length() > 0) out = v.getContentDescription().toString();
        else if (v.getId() != View.NO_ID) {
            try { out = v.getResources().getResourceEntryName(v.getId()); } catch (RuntimeException generated) { out = v.getClass().getSimpleName(); }
        } else out = v.getClass().getSimpleName();
        return out.length() > MAX_LABEL ? out.substring(0, MAX_LABEL) : out;
    }

    // ── store and forward ────────────────────────────────────────────────────

    private void record(String name, String screen, JSONObject data) {
        final long now = System.currentTimeMillis();
        io.execute(() -> {
            try {
                JSONObject e = new JSONObject()
                        .put("id", UUID.randomUUID().toString())
                        .put("event", name)
                        .put("level", "info")
                        .put("ts", iso(now))
                        .put("data", data == null ? new JSONObject() : data)
                        .put("context", new JSONObject().put("app", "phone").put("component", screen).put("sessionId", session));
                store.append(e);
            } catch (Exception lost) {
                Log.w(TAG, "event not kept: " + lost.getClass().getSimpleName());
            }
        });
    }

    private void flush() { flush(false, null); }

    /** Seal what is open and send every waiting batch, oldest first; stop at the first refusal. */
    private void flush(boolean mayStartPayload, java.util.function.Consumer<Boolean> done) {
        io.execute(() -> {
            boolean left = true;
            try { left = flushNow(mayStartPayload); }
            finally {
                int held = left ? Math.max(1, safeWaiting()) : 0;
                if (TelemetrySchedule.needsJob(held, started > 0) || (left && mayStartPayload)) scheduleJob(mayStartPayload);
                if (done != null) done.accept(left);
            }
        });
    }

    /** True when something is still waiting afterwards. On the telemetry thread. */
    private boolean flushNow(boolean mayStartPayload) {
        try {
            store.seal();
            if (store.waiting() == 0) { backoff.ran(false); return false; }
        } catch (Exception failed) {
            Log.w(TAG, "telemetry flush: " + failed.getClass().getSimpleName());
            return true;
        }
        // Only a visible screen may start the shell. The job holds it by binding
        // (ShellStart.hold); starting a service from a job is refused on Android 12+.
        if (started > 0) { try { ShellStart.ensure(app); } catch (RuntimeException refused) { /* sent later */ } }
        return drained(TelemetryDrain.drain(store, TelemetryDrain.port(mayStartPayload ? 15_000 : 4000)), mayStartPayload);
    }

    private int safeWaiting() {
        try { return store.waiting(); } catch (RuntimeException unreadable) { return 1; }
    }

    private boolean drained(TelemetryDrain.Result r, boolean withPayloadHeld) {
        if (r.refused > 0) Log.w(TAG, "telemetry: " + r.refused + " batch(es) refused by home; dropped");
        // Only a run that could have succeeded counts (TelemetrySchedule.countsFailure).
        if (!r.left || TelemetrySchedule.countsFailure(started > 0, withPayloadHeld)) backoff.ran(r.left);
        if (r.left) {
            backoffMs = Math.min(MAX_BACKOFF_MS, backoffMs * 2);
            Log.i(TAG, "telemetry kept for later: " + r.waiting + " batch(es) waiting");
            return true;
        }
        backoffMs = FLUSH_MS;
        if (r.sent > 0) Log.i(TAG, "telemetry sent: " + r.sent + " batch(es)");
        return false;
    }

    /**
     * For a background job that already holds the shell up and has waited for its payload
     * (the media service's 15-minute inbox job): send every batch that waits, on the
     * telemetry thread so it never races a screen's flush, and wait for it up to
     * {@code waitMs}. Answers what was done, or null when it did not finish in time
     * (the batches stay on disk). Never throws. Batches are tiny, so any network will do.
     */
    public static TelemetryDrain.Result flushWithPayloadUp(Context context, long waitMs) {
        UiTelemetry t = get(context);
        java.util.concurrent.Future<TelemetryDrain.Result> f = t.io.submit(() -> {
            TelemetryDrain.Result r = TelemetryDrain.drain(t.store, TelemetryDrain.port(Math.min(waitMs, 15_000)));
            if (t.drained(r, true) && TelemetrySchedule.needsJob(r.waiting, t.started > 0)) t.scheduleJob(true);
            return r;
        });
        try {
            return f.get(waitMs, java.util.concurrent.TimeUnit.MILLISECONDS);
        } catch (Exception notInTime) {
            return null;
        }
    }

    static final int SENT = TelemetryDrain.SENT, LATER = TelemetryDrain.LATER, REFUSED = TelemetryDrain.REFUSED;

    /** What a relay answer means for a batch (TelemetryDrain.outcome). */
    static int outcome(JSONObject reply) { return TelemetryDrain.outcome(reply); }

    private static String iso(long ms) {
        return new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", Locale.US).format(new Date(ms));
    }
}
