package net.kckern.portalkeys.payload;

import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.Handler;
import android.os.HandlerThread;
import net.kckern.portalkeys.api.ShellServices;
import org.json.JSONArray;
import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Runs in the boot-started foreground bridge, independently of accessibility and Fully. */
final class HomeWatchdog {
    private static final String FULLY_HOME = "de.ozerov.fully/.LauncherReplacement";
    private static final String SET_HOME = "android.permission.SET_PREFERRED_APPLICATIONS";
    private final Context context;
    private final ShellServices shell;
    private final SharedPreferences prefs;
    private final HomeWatchState state = new HomeWatchState();
    private final KioskPolicy policy;
    private FkbGuard fkb;
    private final HandlerThread checks = new HandlerThread("portal-home-watch");
    private final HandlerThread delivery = new HandlerThread("portal-home-alert");
    private Handler handler, notifier;
    private volatile boolean stopped;
    private volatile String snapshot = "{\"started\":false,\"ready\":false}";
    private String repair = "not-needed";
    private long lastRepair;
    private volatile long lastHeartbeat;
    private final Object outboxLock = new Object();
    private final BroadcastReceiver receiver = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) { handler.post(check); }
    };
    private final Runnable check = new Runnable() {
        @Override public void run() {
            if (stopped) return;
            handler.removeCallbacks(this);
            try {
                String home = resolveHome();
                String event = state.observe(home, System.currentTimeMillis());
                if (event != null) {
                    try { enqueue(event, home); }
                    catch (Exception e) {
                        // Re-observe the transition on the next tick if queuing failed.
                        state.initialized = prefs.getBoolean("initialized", false);
                        state.homeCorrect = prefs.getBoolean("correct", false);
                        state.incidents = prefs.getLong("incidents", 0);
                        throw e;
                    }
                }
                // A transition is acknowledged only after the private outbox commits it.
                // Retry on every tick, even if Fully's observed state has not changed.
                if (fkb != null) fkb.deliverAlerts(eventName -> enqueue(eventName, state.home));
                policy.enforce(state.homeCorrect);
                boolean owner = policy.isOwner();
                boolean required = prefs.getBoolean("policyRequired", false) || owner;
                boolean secured = state.homeCorrect && policy.protectedHome() && policy.locked() && policy.menusSuppressed();
                boolean wasSecured = prefs.getBoolean("policySecured", true);
                if (required && secured != wasSecured) {
                    enqueue(secured ? "policy-restored" : "policy-lost", home);
                    prefs.edit().putBoolean("policySecured", secured).commit();
                }
                if (owner && !prefs.getBoolean("policyRequired", false)) prefs.edit().putBoolean("policyRequired", true).commit();
                if (!state.homeCorrect) {
                    // The current APK cannot acquire SET_PREFERRED_APPLICATIONS by ADB grant.
                    // Report that limitation; never present foreground recovery as Home repair.
                    boolean authority = context.checkSelfPermission(SET_HOME) == PackageManager.PERMISSION_GRANTED;
                    repair = policy.isOwner() ? "device-policy-repair-pending-verification"
                            : authority ? "pending-verification" : "denied-no-home-authority";
                    long now = android.os.SystemClock.elapsedRealtime();
                    if (lastRepair == 0 || now - lastRepair >= 30000) {
                        lastRepair = now;
                        if (authority) {
                            ShellExec.run("cmd package set-home-activity --user 0 " + FULLY_HOME, 2);
                            // Only the next actual resolution can establish successful recovery.
                        }
                        Intent fully = new Intent().setComponent(new ComponentName("de.ozerov.fully", "de.ozerov.fully.FullyActivity"));
                        fully.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                        try { context.startActivity(fully); }
                        catch (Exception e) { shell.note("HOME", "foreground recovery failed " + e.getClass().getSimpleName()); }
                    }
                } else { repair = "not-needed"; lastRepair = 0; }
                publish(null);
            } catch (Exception e) { publish(e.getClass().getSimpleName()); }
            handler.postDelayed(this, 1000);
        }
    };
    private final Runnable deliver = new Runnable() {
        @Override public void run() {
            if (stopped) return;
            try { deliverOne(); } catch (Exception e) {
                prefs.edit().putString("deliveryError", e.getClass().getSimpleName()).apply();
            }
            notifier.postDelayed(this, 1000);
        }
    };

    HomeWatchdog(Context c, ShellServices s) {
        context = c; shell = s; prefs = c.getSharedPreferences("home-watchdog", Context.MODE_PRIVATE);
        policy = new KioskPolicy(c);
        state.initialized = prefs.getBoolean("initialized", false);
        state.homeCorrect = prefs.getBoolean("correct", false);
        state.incidents = prefs.getLong("incidents", 0);
    }
    void start() {
        checks.start(); delivery.start(); handler = new Handler(checks.getLooper()); notifier = new Handler(delivery.getLooper());
        // Android 9 sends this protected broadcast, but its constant is hidden
        // from the public SDK. Keep the timer as a backup.
        context.registerReceiver(receiver, new IntentFilter("android.intent.action.ACTION_PREFERRED_ACTIVITY_CHANGED"));
        fkb = new FkbGuard(context);
        fkb.start();
        handler.post(check); notifier.post(deliver); shell.note("HOME", "watchdog started intervalMs=1000");
    }
    void stop() {
        stopped = true;
        if (fkb != null) fkb.stop();
        try { context.unregisterReceiver(receiver); } catch (Exception ignored) { }
        if (handler != null) handler.removeCallbacksAndMessages(null);
        if (notifier != null) notifier.removeCallbacksAndMessages(null);
        checks.quitSafely(); delivery.quitSafely();
    }
    JSONObject status() throws Exception { return new JSONObject(snapshot); }
    JSONObject configureShellUi(boolean hidden) throws Exception {
        JSONObject result = policy.configureShellUi(hidden); handler.post(check); return result;
    }
    JSONObject configureWebhook(String value) throws Exception {
        URL u;
        try { u = new URL(value); }
        catch (Exception e) { throw new IllegalArgumentException("Invalid alert webhook URL"); }
        if (!(u.getProtocol().equals("https") || u.getProtocol().equals("http")) || u.getUserInfo() != null)
            throw new IllegalArgumentException("HTTP(S) alert webhook required");
        // The secret URL is never returned in health or diagnostic logs.
        prefs.edit().putString("webhook", value).commit(); handler.post(check);
        return new JSONObject().put("ok", true).put("webhookConfigured", true);
    }
    private String resolveHome() {
        ResolveInfo r = context.getPackageManager().resolveActivity(
                new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), PackageManager.MATCH_DEFAULT_ONLY);
        return r == null || r.activityInfo == null ? null
                : new ComponentName(r.activityInfo.packageName, r.activityInfo.name).flattenToShortString();
    }
    private void publish(String error) {
        try {
            int pending; synchronized (outboxLock) { pending = outbox().length(); }
            boolean configured = !prefs.getString("webhook", "").isEmpty();
            snapshot = new JSONObject().put("started", true).put("intervalMs", 1000)
                    .put("home", state.home == null ? JSONObject.NULL : state.home)
                    .put("homeCorrect", error == null && state.homeCorrect).put("checkedAt", state.checkedAt)
                    .put("incidents", state.incidents).put("repair", repair)
                    .put("permanentHomeProtected", error == null && state.homeCorrect && policy.protectedHome())
                    .put("enforcement", policy.status())
                    .put("fully", fkb == null ? JSONObject.NULL : fkb.status())
                    .put("kioskProtected", error == null && state.homeCorrect && policy.protectedHome() && policy.locked()
                            && policy.menusSuppressed() && fkb != null && fkb.secure())
                    .put("error", error == null ? JSONObject.NULL : error)
                    .put("webhookConfigured", configured).put("pendingAlerts", pending)
                    .put("lastAlertDeliveredAt", prefs.getLong("lastDelivered", 0))
                    .put("heartbeatAgeMs", lastHeartbeat == 0 ? JSONObject.NULL : android.os.SystemClock.elapsedRealtime() - lastHeartbeat)
                    .put("deliveryError", prefs.getString("deliveryError", ""))
                    .put("ready", error == null && state.homeCorrect && configured && pending == 0
                            && fkb != null && fkb.alertsReady()
                            && lastHeartbeat > 0 && android.os.SystemClock.elapsedRealtime() - lastHeartbeat < 15000
                            && prefs.getString("deliveryError", "").isEmpty()).toString();
        } catch (Exception e) { snapshot = "{\"ready\":false,\"error\":\"health-unavailable\"}"; }
    }
    private JSONArray outbox() throws Exception { return new JSONArray(prefs.getString("outbox", "[]")); }
    private void enqueue(String event, String home) throws Exception {
        synchronized (outboxLock) {
            JSONArray queue = outbox();
            // Preserve queued breaches even when Home recovers before network delivery.
            if (queue.length() >= 128) throw new IllegalStateException("alert-outbox-full");
            long sequence = prefs.getLong("sequence", 0) + 1;
            queue.put(new JSONObject().put("event", event).put("sequence", sequence)
                    .put("at", state.checkedAt).put("home", home == null ? JSONObject.NULL : home)
                    .put("incidents", state.incidents).put("device", "school-portal"));
            if (!prefs.edit().putLong("sequence", sequence).putString("outbox", queue.toString())
                    .putBoolean("initialized", true).putBoolean("correct", state.homeCorrect)
                    .putLong("incidents", state.incidents)
                    .putBoolean("fkbSecure", event.startsWith("fkb-") ? event.equals("fkb-restored") : prefs.getBoolean("fkbSecure", true)).commit())
                throw new IllegalStateException("alert-storage-failed");
        }
        shell.note("HOME", event + " incidents=" + state.incidents + " home=" + home);
    }
    private void deliverOne() throws Exception {
        String endpoint = prefs.getString("webhook", ""); if (endpoint.isEmpty()) return;
        JSONObject event;
        synchronized (outboxLock) {
            JSONArray q = outbox();
            if (q.length() == 0) {
                if (android.os.SystemClock.elapsedRealtime() - lastHeartbeat < 5000) return;
                event = new JSONObject().put("event", "heartbeat").put("device", "school-portal")
                        .put("at", System.currentTimeMillis())
                        .put("checkedAt", new JSONObject(snapshot).optLong("checkedAt", 0))
                        .put("fkbCheckedAt", fkb == null ? 0 : fkb.checkedAt());
            } else event = q.getJSONObject(0);
        }
        HttpURLConnection c = (HttpURLConnection) new URL(endpoint).openConnection();
        c.setConnectTimeout(2000); c.setReadTimeout(2000); c.setInstanceFollowRedirects(false);
        c.setRequestMethod("POST"); c.setRequestProperty("Content-Type", "application/json"); c.setDoOutput(true);
        try {
            byte[] body = event.toString().getBytes(StandardCharsets.UTF_8);
            c.setFixedLengthStreamingMode(body.length);
            try (java.io.OutputStream out = c.getOutputStream()) { out.write(body); }
            int code = c.getResponseCode(); if (code < 200 || code >= 300) throw new IllegalStateException("alert-http-" + code);
            synchronized (outboxLock) {
                JSONArray q = outbox();
                if (event.has("sequence")) {
                    if (q.length() > 0 && q.getJSONObject(0).getLong("sequence") == event.getLong("sequence")) q.remove(0);
                    prefs.edit().putString("outbox", q.toString()).putLong("lastDelivered", System.currentTimeMillis())
                            .putString("deliveryError", "").commit();
                } else {
                    lastHeartbeat = android.os.SystemClock.elapsedRealtime();
                    prefs.edit().putString("deliveryError", "").apply();
                }
            }
        } finally { c.disconnect(); }
    }
}
