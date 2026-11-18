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
    private final HomeWatchdogStorage storage;
    private final HomeWatchState state = new HomeWatchState();
    private final KioskPolicy policy;
    private FkbGuard fkb;
    private final HandlerThread checks = new HandlerThread("portal-home-watch");
    private final HandlerThread delivery = new HandlerThread("portal-home-alert");
    private Handler handler, notifier;
    private volatile boolean stopped;
    private volatile String snapshot = "{\"started\":false,\"ready\":false}";
    // Deliberate release gate: actual HTTPS Fully transport AND draft preservation are unverified.
    static final boolean PAGE_RECOVERY_VERIFIED=false;
    private final PageWatchState page=new PageWatchState();
    private long pageBeat=-1, pageSequence=-1;
    private String pageActivity="", pageBuild="unknown", pageIncident="";
    private boolean pageVisible;
    private final long processStarted=android.os.SystemClock.elapsedRealtime();
    private final String processId=java.util.UUID.randomUUID().toString();
    private String pageStage="starting";
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
                synchronized(outboxLock) { storage.retryBeforeObserve(state); }
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
                RecoveryGuard recovery=new RecoveryGuard(HomeWatchdog.this::pageSafety,PAGE_RECOVERY_VERIFIED);
                policy.enforcePassive(state.homeCorrect);
                policy.recoverActivity(state.homeCorrect,recovery);
                boolean owner = policy.isOwner();
                boolean required = prefs.getBoolean("policyRequired", false) || owner;
                boolean secured = state.homeCorrect && policy.protectedHome() && policy.locked() && policy.menusSuppressed();
                boolean wasSecured = prefs.getBoolean("policySecured", true);
                if (required && secured != wasSecured) {
                    enqueue(secured ? "policy-restored" : "policy-lost", home);
                }
                if (owner && !prefs.getBoolean("policyRequired", false)) prefs.edit().putBoolean("policyRequired", true).commit();
                if (policy.held()) {
                    // Policy was released for an ownership transfer; another app may own
                    // Home now, so this watchdog must not pull Fully back to the front.
                    repair = "held-for-owner-transfer"; lastRepair = 0;
                } else if (!state.homeCorrect) {
                    // The current APK cannot acquire SET_PREFERRED_APPLICATIONS by ADB grant.
                    // Report that limitation; never present foreground recovery as Home repair.
                    boolean authority = context.checkSelfPermission(SET_HOME) == PackageManager.PERMISSION_GRANTED;
                    repair = policy.isOwner() ? "device-policy-repair-pending-verification"
                            : authority ? "pending-verification" : "denied-no-home-authority";
                    long now = android.os.SystemClock.elapsedRealtime();
                    if (lastRepair == 0 || now - lastRepair >= 30000) {
                        lastRepair = now;
                        repairHome(recovery,authority,() -> {
                            ShellExec.run("cmd package set-home-activity --user 0 " + FULLY_HOME,2);
                            // Only the next actual resolution can establish successful recovery.
                        },() -> {
                            Intent fully=new Intent().setComponent(new ComponentName("de.ozerov.fully","de.ozerov.fully.FullyActivity"));
                            fully.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                            context.startActivity(fully);
                        });
                    }
                } else { repair = "not-needed"; lastRepair = 0; }
                checkPage();
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
        pageIncident=prefs.getString("pageIncident","");
        storage=new HomeWatchdogStorage(prefs);
        int boot;
        try { boot=android.provider.Settings.Global.getInt(c.getContentResolver(),"boot_count",-1); }
        catch(Exception unavailable) { boot=-1; }
        storage.restoreBudget(page,processStarted,boot);
        page.evaluate(processStarted,0,false,false,true);
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
    String pageOrigin() { return prefs.getString("pageOrigin",""); }
    JSONObject configurePage(JSONObject value) throws Exception {
        String origin=value.getString("origin");
        java.net.URI uri=new java.net.URI(origin);
        if (!"https".equals(uri.getScheme()) || uri.getHost()==null || uri.getUserInfo()!=null
                || uri.getRawQuery()!=null || uri.getRawFragment()!=null || !uri.getRawPath().isEmpty())
            throw new IllegalArgumentException("exact HTTPS origin required");
        if (!prefs.edit().putString("pageOrigin",origin).putBoolean("pageRecoveryRequested",value.optBoolean("recovery",false)).commit())
            throw new IllegalStateException("page-config-storage-failed");
        return new JSONObject().put("ok",true).put("recoveryEnabled",false).put("physicalGateVerified",PAGE_RECOVERY_VERIFIED);
    }
    synchronized JSONObject pageJournal() throws Exception { return new JSONObject().put("entries",new JSONArray(prefs.getString("pageJournal","[]"))); }
    synchronized void pageBeat(JSONObject beat) throws Exception {
        if (!(beat.get("protocol") instanceof Number) || beat.getDouble("protocol")!=1 || !(beat.get("visible") instanceof Boolean)) throw new IllegalArgumentException("invalid beat");
        String activity=beat.getString("activityId"), build=beat.getString("build");
        Object rawSeq=beat.get("seq");
        if (!(rawSeq instanceof Number)) throw new IllegalArgumentException("invalid sequence");
        long seq=((Number)rawSeq).longValue();
        if (seq<1 || seq>9007199254740991L || ((Number)rawSeq).doubleValue()!=seq
                || !activity.matches("[A-Za-z0-9_-]{1,80}") || !build.matches("[A-Za-z0-9_.-]{1,100}"))
            throw new IllegalArgumentException("invalid beat metadata");
        if (activity.equals(pageActivity) && seq<=pageSequence) throw new IllegalArgumentException("stale beat");
        pageActivity=activity; pageBuild=build; pageSequence=seq; pageVisible=beat.getBoolean("visible");
        pageBeat=android.os.SystemClock.elapsedRealtime();
    }
    private JSONObject pageSafety() {
        if (policy.held()) return new JSONObject();
        try { return new JSONObject(shell.pageSafetySnapshot()); }
        catch (Exception | LinkageError oldShell) { return new JSONObject(); }
    }
    static void repairHome(RecoveryGuard guard, boolean authority, Runnable preferredHome, Runnable foreground) {
        if (authority) guard.run(false,preferredHome);
        guard.run(true,foreground);
    }
    static boolean pageSafe(JSONObject safety) {
        return safety.optBoolean("known",false) && safety.optBoolean("expectedAwake",false)
                && !safety.optBoolean("stopped",true) && !safety.optBoolean("maintenance",true);
    }
    private synchronized void checkPage() throws Exception {
        long now=android.os.SystemClock.elapsedRealtime();
        JSONObject safety=pageSafety();
        PageWatchState.Decision decision=page.evaluate(now,Math.max(0,pageBeat),pageSafe(safety) && !pageOrigin().isEmpty(),
                safety.optBoolean("stopped",true),safety.optBoolean("maintenance",true));
        String stage=decision.state.name()+":"+decision.action.name();
        if (decision.state==PageWatchState.State.DEGRADED && pageIncident.isEmpty()) {
            pageIncident=java.util.UUID.randomUUID().toString();
            if (!prefs.edit().putString("pageIncident",pageIncident).commit()) throw new IllegalStateException("page-storage-failed");
        }
        if (!stage.equals(pageStage) || decision.action!=PageWatchState.Action.NONE) {
            pageStage=stage; journalPage(stage,safety,null);
        }
        if ((decision.state==PageWatchState.State.RECOVERED || decision.state==PageWatchState.State.SUPPRESSED) && !pageIncident.isEmpty()) {
            if (!prefs.edit().putString("pageIncident","").commit()) throw new IllegalStateException("page-storage-failed");
            pageIncident="";
        }
        if (decision.state==PageWatchState.State.FAILED)
            enqueue("page-failed",state.home);
        if (decision.action==PageWatchState.Action.NONE) return;
        int boot=android.provider.Settings.Global.getInt(context.getContentResolver(),"boot_count",-1);
        final boolean[] dispatched={false};
        storage.commitBudgetThen(page,boot,() -> {
            JSONObject current=pageSafety();
            if (!PAGE_RECOVERY_VERIFIED || !prefs.getBoolean("pageRecoveryRequested",false) || !pageSafe(current)
                    || current.optLong("revision",-1)!=safety.optLong("revision",-2)) return;
            dispatched[0]=true;
            // Recheck again on the Fully worker immediately before each native command.
            fkb.recoverPage(decision.action,() -> {
                JSONObject latest=pageSafety();
                return pageSafe(latest) && latest.optLong("revision",-1)==safety.optLong("revision",-2);
            });
        });
        if(!dispatched[0])journalPage("dispatch-suppressed",pageSafety(),"release-gate-or-safety");
    }

    private synchronized void journalPage(String stage,JSONObject safety,String error) throws Exception {
        JSONArray old=new JSONArray(prefs.getString("pageJournal","[]")), entries=new JSONArray();
        for (int i=Math.max(0,old.length()-255);i<old.length();i++) entries.put(old.get(i));
        String network;
        try {
            android.net.ConnectivityManager manager=(android.net.ConnectivityManager)context.getSystemService(Context.CONNECTIVITY_SERVICE);
            android.net.NetworkInfo info=manager.getActiveNetworkInfo();
            network=info==null?"disconnected":info.getState().name();
        } catch (Exception e) { network="unavailable:"+e.getClass().getSimpleName(); }
        entries.put(new JSONObject().put("at",java.time.Instant.now().toString()).put("device","school-portal")
                .put("payload",Main.VERSION).put("shell",shell.shellVersionCode()).put("build",pageBuild)
                .put("process",processId).put("pid",android.os.Process.myPid()).put("uptimeMs",android.os.SystemClock.elapsedRealtime())
                .put("processAgeMs",android.os.SystemClock.elapsedRealtime()-processStarted).put("incidentId",pageIncident)
                .put("stage",stage).put("safety",safety).put("network",network)
                .put("pageAgeMs",pageBeat<0?JSONObject.NULL:android.os.SystemClock.elapsedRealtime()-pageBeat)
                .put("visible",pageVisible).put("seq",pageSequence).put("activityId",pageActivity)
                .put("error",error==null?JSONObject.NULL:error));
        if (!prefs.edit().putString("pageJournal",entries.toString()).commit()) throw new IllegalStateException("page-journal-storage-failed");
    }
    JSONObject status() throws Exception { return new JSONObject(snapshot); }
    JSONObject configureShellUi(boolean hidden) throws Exception {
        JSONObject result = policy.configureShellUi(hidden); handler.post(check); return result;
    }
    OwnerTransfer.Result transferOwner(String to) {
        shell.note("OWNER", "transfer requested to=" + to);
        OwnerTransfer.Result r = policy.transferOwner(to);
        shell.note("OWNER", "transfer ok=" + r.ok + " error=" + r.error + " policyReleased=" + r.policyReleased
                + " transferred=" + r.transferred + " released=" + r.released + " releaseFailures=" + r.releaseFailures
                + (r.exception == null ? "" : " exception=" + r.exception + ": " + r.message));
        handler.post(check);
        return r;
    }
    JSONObject resumePolicy() throws Exception {
        JSONObject result = policy.resume(); shell.note("OWNER", "policy enforcement resumed by request");
        handler.post(check); return result;
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
                    .put("page",new JSONObject().put("stage",pageStage).put("incidentId",pageIncident)
                            .put("recoveryEnabled",PAGE_RECOVERY_VERIFIED && prefs.getBoolean("pageRecoveryRequested",false))
                            .put("physicalGateVerified",PAGE_RECOVERY_VERIFIED).put("originConfigured",!pageOrigin().isEmpty())
                            .put("beatAgeMs",pageBeat<0?JSONObject.NULL:android.os.SystemClock.elapsedRealtime()-pageBeat)
                            .put("build",pageBuild).put("activityId",pageActivity).put("safety",pageSafety()))
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
    private JSONArray outbox() throws Exception { return storage.outbox(); }
    private void enqueue(String event, String home) throws Exception {
        synchronized (outboxLock) {
            if(!storage.enqueue(event,home,state,pageIncident))return;
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
