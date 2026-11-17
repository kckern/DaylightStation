package net.kckern.pianobridge;

import android.content.Context;
import android.content.res.AssetManager;
import android.util.Log;

import net.kckern.pianobridge.api.Payload;
import net.kckern.pianobridge.api.ShellServices;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import dalvik.system.DexClassLoader;

/**
 * PayloadLoader — the shell's one job: get a payload running, keep it running, and
 * swap it on request with nothing a human has to touch.
 *
 * The shell is the installed APK. Android freezes its manifest (permissions, the
 * a11y service, the foreground service, the native .so) at install time, and
 * changing any of those costs a physical tap on the tablet. EVERYTHING ELSE — the
 * control plane, the MIDI logic, the kiosk watchdog — lives in a payload .jar that
 * this class loads from app-private storage with {@link DexClassLoader}. A new
 * payload is one {@code POST /payload} over the LAN.
 *
 * Resilience rules (the reason this is not just "load a jar"):
 *  - A payload is activated only after its sha256 matches ({@link PayloadStore#commit}).
 *  - If {@code start()} throws, roll back to the previous payload immediately.
 *  - If the process keeps dying with a payload current (3 boots in 10 min), the
 *    NEXT boot rolls back before loading — a bad drop self-heals in ~10 min.
 *  - If nothing loads at all, fall back to the payload baked into the APK's assets
 *    so a fresh install is never payload-less.
 *
 * The installed shell admits only explicitly reviewed native-safety-compatible payload identities.
 */
public final class PayloadLoader {

    private static final String TAG = "PianoBridge-Loader";
    static final String ENTRY_CLASS = "net.kckern.pianobridge.payload.Main";
    static final String BAKED_ASSET = "payload-baked.jar";
    static final String BAKED_NAME = "p38-managed-candidate-baked.jar";

    interface PayloadFactory { Payload create(String jar) throws Exception; }
    private PayloadFactory factory;
    private Runnable prepareBaked;
    private final Context ctx;
    private final PayloadStore store;
    private final ShellServices shell;
    private final ExecutorService exec = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "PianoBridge-payload"); t.setDaemon(true); return t;
    });

    private volatile Payload active;
    private volatile String activeJar;
    private volatile String lastError;
    private volatile int bootsThisPayload;

    public PayloadLoader(Context ctx, ShellServices shell) {
        this.ctx = ctx;
        this.shell = shell;
        this.store = new PayloadStore(new File(ctx.getFilesDir(), "payloads"));
        factory=this::instantiate;
        prepareBaked=this::ensureBaked;
    }

    PayloadLoader(PayloadStore store, ShellServices shell, PayloadFactory factory, Runnable prepareBaked) {
        ctx=null; this.store=store; this.shell=shell; this.factory=factory; this.prepareBaked=prepareBaked;
    }

    public PayloadStore store() { return store; }
    public Payload active() { return active; }
    public String activeJar() { return activeJar; }

    // ── boot ────────────────────────────────────────────────────────────────

    /**
     * Load the right payload for this boot. Order: crash-loop rollback check →
     * compatible current/previous selection → baked asset. Synchronous; called from the Service's
     * onStartCommand so the bridge is up before it returns.
     */
    public synchronized void boot() {
        long now=System.currentTimeMillis();
        java.util.LinkedHashSet<String> candidates=new java.util.LinkedHashSet<>();
        // Keep durable pointers intact while selecting a compatible fallback. A legacy
        // payload must never start merely because it was current/previous before upgrade.
        if (store.shouldRollBack(now)) candidates.add(store.previous());
        candidates.add(store.current());
        candidates.add(store.previous());
        for (String jar:candidates) {
            if (jar!=null && tryBoot(jar, now)) return;
        }
        prepareBaked.run();
        if (!tryBoot(BAKED_NAME, now)) shell.note("PAYLOAD", "no compatible payload available: " + lastError);
    }

    private boolean tryBoot(String jar, long now) {
        try {
            store.recordBoot(jar, now);
            bootsThisPayload=store.recentBoots(jar, now);
        } catch (Exception ignored) { }
        return load(jar);
    }

    /** Compatibility declaration only; download integrity still requires SHA-256. */
    static boolean compatibleVersion(String version) { return "p38-managed-candidate".equals(version); }

    private boolean mayMutate() {
        try { return shell.nativeSafety().allowsRun(android.os.SystemClock.elapsedRealtime()); }
        catch (RuntimeException | LinkageError e) { return false; }
    }


    /** Orderly shutdown (Service.onDestroy). Clears the crash counter for this payload. */
    public synchronized void shutdown() {
        unloadActive();
        if (activeJar != null) store.markCleanStop(activeJar);
    }

    // ── swap / rollback (async: called from the payload's own HTTP thread) ──

    public String requestSwap(String url, String sha256) {
        if (!mayMutate()) return "refused: native safety unavailable or stopped";
        if (url == null || url.isEmpty()) return "refused: no url";
        if (sha256 == null || sha256.trim().length() < 32) return "refused: sha256 required";
        exec.submit(() -> swap(url, sha256.trim()));
        return "accepted: fetching " + url;
    }

    /** Stop and re-start the CURRENT payload in place (no fetch). For a wedged server. */
    public String requestRestart() {
        if (!mayMutate()) return "refused: native safety unavailable or stopped";
        String cur = activeJar!=null ? activeJar : store.current();
        if (cur == null) return "refused: no current payload";
        exec.submit(() -> { synchronized (this) {
            if (!mayMutate()) return;
            unloadActive();
            shell.note("PAYLOAD", "manual restart of " + cur);
            if (!load(cur)) boot();
        } });
        return "accepted: restarting " + cur;
    }

    public String requestRollback() {
        if (!mayMutate()) return "refused: native safety unavailable or stopped";
        if (store.previous() == null) return "refused: no previous payload";
        exec.submit(this::rollbackNow);
        return "accepted: rolling back to " + store.previous();
    }

    private synchronized void swap(String url, String sha256) {
        if (!mayMutate()) return;
        String name = jarNameFrom(url, sha256);
        File part = new File(store.dir(), name + ".part");
        try {
            shell.note("PAYLOAD", "fetch " + url);
            download(url, part);
            store.commit(part, name, sha256);
            shell.note("PAYLOAD", "verified " + name + " sha256=" + sha256.substring(0, 12) + "…");
            if (!mayMutate()) throw new IllegalStateException("native safety revoked");
            if (!compatibleVersion(factory.create(name).version())) throw new IllegalStateException("payload safety compatibility unavailable");
            unloadActive();
            store.activate(name);
            store.recordBoot(name, System.currentTimeMillis());
            if (!load(name)) {
                String to = store.rollback();
                shell.note("PAYLOAD", "new payload " + name + " failed to start -> rollback to " + to + " (" + lastError + ")");
                if (to == null || !load(to)) boot();
            } else {
                shell.note("PAYLOAD", "ACTIVE " + name + " v=" + safeVersion());
            }
        } catch (Exception e) {
            lastError = e.getClass().getSimpleName() + ": " + e.getMessage();
            shell.note("PAYLOAD", "swap FAILED: " + lastError);
            part.delete();
            // The old payload was only unloaded AFTER commit succeeded, so a download
            // or sha failure leaves it untouched and running.
            if (active == null) boot();
        }
    }

    private synchronized void rollbackNow() {
        try {
            if (!mayMutate()) return;
            String previous=store.previous();
            if (previous==null || !compatibleVersion(factory.create(previous).version())) {
                lastError="rollback refused: payload safety compatibility unavailable";
                shell.note("PAYLOAD", lastError);
                return; // Preserve both pointers and the running managed candidate.
            }
            if (!mayMutate()) return;
            unloadActive();
            String to = store.rollback();
            shell.note("PAYLOAD", "manual rollback -> " + to);
            if (to == null || !load(to)) boot();
        } catch (Exception e) {
            lastError = e.getMessage();
            shell.note("PAYLOAD", "manual rollback FAILED: " + lastError);
        }
    }

    // ── status ──────────────────────────────────────────────────────────────

    public JSONObject status() {
        JSONObject o = new JSONObject();
        try {
            o.put("ok", true);
            o.put("current", store.current() == null ? JSONObject.NULL : store.current());
            o.put("previous", store.previous() == null ? JSONObject.NULL : store.previous());
            o.put("active", activeJar == null ? JSONObject.NULL : activeJar);
            o.put("activeVersion", active == null ? JSONObject.NULL : safeVersion());
            o.put("available", new JSONArray(store.available()));
            o.put("bootsThisPayload", bootsThisPayload);
            o.put("crashLimit", PayloadStore.CRASH_LIMIT);
            o.put("crashWindowMs", PayloadStore.CRASH_WINDOW_MS);
            o.put("lastError", lastError == null ? JSONObject.NULL : lastError);
            o.put("entryClass", ENTRY_CLASS);
        } catch (Exception ignored) { }
        return o;
    }

    // ── a11y forwarding (shell owns the service, payload owns the policy) ──

    public void onAccessibilityConnected(Object svc) {
        Payload p = active;
        if (p != null) try { p.onAccessibilityConnected(svc); } catch (Throwable t) { Log.w(TAG, "a11y connect forward threw", t); }
    }

    public void onAccessibilityDisconnected() {
        Payload p = active;
        if (p != null) try { p.onAccessibilityDisconnected(); } catch (Throwable t) { Log.w(TAG, "a11y disconnect forward threw", t); }
    }

    // ── internals ───────────────────────────────────────────────────────────

    /** Load + start one jar. Returns false (and sets lastError) if it cannot run. */
    private boolean load(String jar) {
        try {
            Payload p = factory.create(jar);
            if (!compatibleVersion(p.version())) throw new IllegalStateException("payload safety compatibility unavailable");
            p.start(shell);
            active = p;
            activeJar = jar;
            lastError = null;
            Log.i(TAG, "payload ACTIVE " + jar + " v=" + safeVersion());
            return true;
        } catch (Throwable t) {
            lastError = t.getClass().getSimpleName() + ": " + t.getMessage();
            Log.e(TAG, "payload " + jar + " failed to load/start", t);
            active = null;
            activeJar = null;
            return false;
        }
    }

    private Payload instantiate(String jar) throws Exception {
        File f=new File(store.dir(), jar);
        File opt=new File(ctx.getCodeCacheDir(), "payload-opt");
        if (!opt.exists()) opt.mkdirs();
        DexClassLoader cl=new DexClassLoader(f.getAbsolutePath(), opt.getAbsolutePath(), null, ctx.getClassLoader());
        return (Payload)cl.loadClass(ENTRY_CLASS).getDeclaredConstructor().newInstance();
    }

    private void unloadActive() {
        Payload p = active;
        if (p == null) return;
        try { p.stop(); } catch (Throwable t) { Log.w(TAG, "payload stop threw", t); }
        active = null;
        // activeJar intentionally kept until the next load so shutdown() can clear its counter.
    }

    /** Extract the payload baked into the APK, so a fresh install has something to run. */
    private void ensureBaked() {
        File dst = new File(store.dir(), BAKED_NAME);
        try {
            if (!dst.isFile()) {
                AssetManager am = ctx.getAssets();
                try (InputStream in = am.open(BAKED_ASSET); FileOutputStream out = new FileOutputStream(dst)) {
                    byte[] buf = new byte[65536];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                }
            }
            shell.note("PAYLOAD", "using baked " + BAKED_NAME);
        } catch (Exception e) {
            lastError = "baked payload unavailable: " + e.getMessage();
            Log.e(TAG, lastError);
        }
    }

    private static void download(String url, File dst) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(60000);
        try (InputStream in = c.getInputStream(); FileOutputStream out = new FileOutputStream(dst)) {
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        } finally {
            c.disconnect();
        }
    }

    /** Stable, filesystem-safe jar name: the URL's basename, or the sha if it has none. */
    static String jarNameFrom(String url, String sha256) {
        String base = url.substring(url.lastIndexOf('/') + 1);
        int q = base.indexOf('?');
        if (q >= 0) base = base.substring(0, q);
        base = base.replaceAll("[^A-Za-z0-9._-]", "");
        if (base.isEmpty() || !base.endsWith(".jar")) base = "p-" + sha256.substring(0, 12) + ".jar";
        return base;
    }

    private String safeVersion() {
        try { return active == null ? "?" : active.version(); } catch (Throwable t) { return "?"; }
    }
}
