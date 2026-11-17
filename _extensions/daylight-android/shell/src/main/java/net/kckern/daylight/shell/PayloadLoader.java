package net.kckern.daylight.shell;

import android.content.Context;
import android.util.Log;

import net.kckern.daylight.api.Payload;
import net.kckern.daylight.api.ShellServices;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.FutureTask;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.regex.Pattern;

import dalvik.system.DexClassLoader;

/**
 * PayloadLoader gets a payload running, keeps one running, and swaps it on request.
 *
 * The shell is the installed APK. Android fixes its manifest (permissions, declared
 * services and receivers, native libraries) at install time. Everything else, the
 * core and the device's capabilities, lives in a payload jar that this class loads
 * from app-private storage. A new payload is one {@code POST /payload} to the lifeline.
 *
 * Rules:
 *  - A pushed payload is stored under its content hash and activated only after its
 *    sha256 matches ({@link PayloadStore#commit}).
 *  - Every operation (boot, swap, rollback, restart) runs on one worker thread, one
 *    at a time. Requests only queue work, so the lifeline answers while one runs.
 *  - {@code start()} runs on its own thread with a deadline. If it throws or does not
 *    return in time, that payload is marked failed and the loader goes to the
 *    previous payload, and after that to the payload baked into the APK.
 *  - If the process keeps dying with a payload current (3 boots in 10 minutes), the
 *    next boot rolls back before loading it.
 *  - When the shell stamp (its versionCode) differs from the recorded one, a new APK
 *    was installed: its baked payload is extracted and made current, and the payload
 *    that was current becomes previous.
 *
 * This class has no opinion about what a payload does.
 */
public final class PayloadLoader {

    private static final String TAG = "Daylight-Loader";
    static final String ENTRY_CLASS = "net.kckern.daylight.payload.Main";
    static final String BAKED_ASSET = "payload-baked.jar";
    static final long START_DEADLINE_MS = 20_000L;
    /** The largest pushed payload the shell will download. A payload jar is a few megabytes. */
    static final long MAX_PAYLOAD_BYTES = 64L * 1024 * 1024;
    private static final Pattern SHA256 = Pattern.compile("[0-9a-fA-F]{64}");

    /** Turns a payload jar into a Payload instance. The device uses a dex class loader; tests supply fakes. */
    interface PayloadSource { Payload open(File jar) throws Exception; }

    /** Writes the payload baked into the APK to a file. Throws when the APK has none. */
    interface BakedPayload { void extractTo(File dst) throws Exception; }

    /** Downloads a pushed payload. */
    interface Fetcher { void fetch(String url, File dst) throws Exception; }

    private final PayloadStore store;
    private final ShellServices shell;
    private final PayloadSource source;
    private final BakedPayload baked;
    private final Fetcher fetcher;
    private final String shellStamp;
    private final long startDeadlineMs;
    private final ExecutorService exec = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "Daylight-payload"); t.setDaemon(true); return t;
    });

    private volatile Payload active;
    private volatile String activeJar;
    private volatile String starting;
    private volatile String lastError;
    private volatile String lastFailed;
    private volatile int bootsThisPayload;
    private volatile boolean closed;

    public PayloadLoader(final Context ctx, ShellServices shell, int shellVersionCode) {
        this(new File(ctx.getFilesDir(), "payloads"), shell, dexSource(ctx), assetPayload(ctx), PayloadLoader::download,
                String.valueOf(shellVersionCode), START_DEADLINE_MS);
    }

    PayloadLoader(File dir, ShellServices shell, PayloadSource source, BakedPayload baked, Fetcher fetcher,
                  String shellStamp, long startDeadlineMs) {
        this.store = new PayloadStore(dir);
        this.shell = shell;
        this.source = source;
        this.baked = baked;
        this.fetcher = fetcher;
        this.shellStamp = shellStamp.replaceAll("[^A-Za-z0-9._-]", "");
        this.startDeadlineMs = startDeadlineMs;
    }

    public PayloadStore store() { return store; }
    public Payload active() { return active; }
    public String activeJar() { return activeJar; }

    /** The file name the baked payload of this shell is extracted to. */
    String bakedName() { return PayloadStore.BAKED_PREFIX + "-v" + shellStamp + ".jar"; }

    // ── boot ────────────────────────────────────────────────────────────────

    /**
     * Queue the boot: pick the payload for this process and start it. Returns at
     * once, so the service's main thread is never held by a payload's start().
     */
    public Future<?> boot() { return submit(this::bootNow); }

    private void bootNow() {
        long now = System.currentTimeMillis();
        if (!shellStamp.equals(store.shellStamp())) {
            adoptBaked();
        } else {
            try {
                if (store.shouldRollBack(now)) {
                    String from = store.current();
                    String to = store.rollback();
                    shell.note("PAYLOAD", "ROLLBACK at boot: " + from + " crash-looped -> " + to);
                }
            } catch (Exception e) {
                Log.w(TAG, "rollback check failed", e);
            }
        }
        if (store.current() == null) {
            String name = ensureBakedFile();
            if (name != null) {
                try {
                    store.activate(name);
                    shell.note("PAYLOAD", "using baked " + name);
                } catch (Exception e) {
                    lastError = "baked payload unavailable: " + e.getMessage();
                }
            }
        }
        String jar = store.current();
        if (jar == null) {
            lastError = "no payload available (no current, no baked asset)";
            shell.note("PAYLOAD", lastError);
            return;
        }
        try {
            store.recordBoot(jar, now);
            bootsThisPayload = store.recentBoots(jar, now);
        } catch (Exception ignored) { }
        startOrFallBack(jar);
    }

    /**
     * A different shell is installed than the one that last ran here. Its baked
     * payload was built with it, so that payload becomes current, and what was
     * current stays one rollback away as previous.
     */
    private void adoptBaked() {
        String name = bakedName();
        try {
            extractBaked(name);
            String old = store.current();
            store.activate(name);
            store.markCleanStop(name);
            store.recordShellStamp(shellStamp);
            shell.note("PAYLOAD", "shell " + shellStamp + " installed: baked " + name + " is current, previous " + old);
        } catch (Exception e) {
            // The stamp is not recorded, so the next boot tries again.
            lastError = "baked payload unavailable: " + e.getMessage();
            shell.note("PAYLOAD", lastError);
            Log.e(TAG, lastError, e);
        }
    }

    /** Orderly shutdown (Service.onDestroy). Nothing queued runs after this, and the crash counter is cleared. */
    public void shutdown() {
        closed = true;
        exec.shutdownNow();
        try { exec.awaitTermination(2, TimeUnit.SECONDS); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        unloadActive();
        String jar = activeJar;
        if (jar != null) store.markCleanStop(jar);
    }

    // ── swap / rollback / restart: each only queues work ────────────────────

    public String requestSwap(final String url, String sha256) {
        if (url == null || url.isEmpty()) return "refused: no url";
        if (sha256 == null || !SHA256.matcher(sha256.trim()).matches()) return "refused: sha256 must be 64 hex characters";
        final String sha = sha256.trim().toLowerCase(java.util.Locale.ROOT);
        if (submit(() -> swap(url, sha)) == null) return "refused: loader is shut down";
        return "accepted: fetching " + url;
    }

    /** Stop and start the current payload in place, with no fetch. For a payload that stopped answering. */
    public String requestRestart() {
        String cur = store.current();
        if (cur == null) return "refused: no current payload";
        if (submit(() -> {
            // Read the pointer when the restart runs: an operation queued ahead of it may have moved it.
            String now = store.current();
            if (now == null) return;
            unloadActive();
            shell.note("PAYLOAD", "manual restart of " + now);
            startOrFallBack(now);
        }) == null) return "refused: loader is shut down";
        return "accepted: restarting " + cur;
    }

    /**
     * Stop the payload, delete its stored settings overrides, and start a payload again:
     * the current one, or the baked one when there is none. For a stored setting that
     * keeps every payload from starting. The file is deleted between stop and start,
     * on the worker thread, so no running payload can write it back.
     */
    public String requestSettingsReset() {
        if (submit(() -> {
            unloadActive();
            File dir = shell.payloadDir();
            boolean gone = net.kckern.daylight.api.PayloadState.deleteSettingsOverrides(dir == null ? store.dir() : dir);
            shell.note("PAYLOAD", "settings reset: overrides " + (gone ? "deleted" : "could NOT be deleted"));
            String now = store.current();
            if (now == null) {
                now = ensureBakedFile();
                if (now == null) return;
                try { store.activate(now); } catch (Exception e) { lastError = "baked payload unavailable: " + e.getMessage(); return; }
            }
            startOrFallBack(now);
        }) == null) return "refused: loader is shut down";
        return "accepted: resetting settings and restarting";
    }

    public String requestRollback() {
        String prev = store.previous();
        if (prev == null) return "refused: no previous payload";
        if (submit(this::rollbackNow) == null) return "refused: loader is shut down";
        return "accepted: rolling back to " + prev;
    }

    private void swap(String url, String sha256) {
        String name = PayloadStore.pushedName(sha256);
        File part = new File(store.dir(), name + ".part");
        try {
            shell.note("PAYLOAD", "fetch " + url);
            fetcher.fetch(url, part);
            File existing = new File(store.dir(), name);
            if (existing.isFile() && sha256.equals(PayloadStore.sha256(existing))) {
                // The same payload was pushed before. Check the download, then keep the stored
                // file, so a jar that may be running is not replaced underneath its class loader.
                if (!sha256.equals(PayloadStore.sha256(part))) {
                    throw new java.io.IOException("sha256 mismatch: expected " + sha256 + " got " + PayloadStore.sha256(part));
                }
                part.delete();
            } else {
                store.commit(part, name, sha256);
            }
            shell.note("PAYLOAD", "verified " + name + " sha256=" + sha256.substring(0, 12) + "…");
            if (closed) {
                // The service was destroyed during the fetch. The jar is stored; nothing is activated.
                shell.note("PAYLOAD", "shut down before " + name + " was activated");
                return;
            }
            unloadActive();
            store.activate(name);
            store.recordBoot(name, System.currentTimeMillis());
            if (startOrFallBack(name)) shell.note("PAYLOAD", "ACTIVE " + name + " v=" + safeVersion());
        } catch (Exception e) {
            lastError = e.getClass().getSimpleName() + ": " + e.getMessage();
            shell.note("PAYLOAD", "swap FAILED: " + lastError);
            part.delete();
            // The running payload is unloaded only after the download is verified, so a
            // download or sha failure leaves it running.
            if (!closed && active == null && store.current() != null) startOrFallBack(store.current());
        }
    }

    private void rollbackNow() {
        try {
            unloadActive();
            String to = store.rollback();
            shell.note("PAYLOAD", "manual rollback -> " + to);
            if (to != null) startOrFallBack(to);
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
            o.put("current", orNull(store.current()));
            o.put("previous", orNull(store.previous()));
            o.put("active", orNull(activeJar));
            o.put("activeVersion", active == null ? JSONObject.NULL : safeVersion());
            o.put("starting", orNull(starting));
            o.put("available", new JSONArray(store.available()));
            o.put("baked", bakedName());
            o.put("shellStamp", orNull(store.shellStamp()));
            o.put("bootsThisPayload", bootsThisPayload);
            o.put("crashLimit", PayloadStore.CRASH_LIMIT);
            o.put("crashWindowMs", PayloadStore.CRASH_WINDOW_MS);
            o.put("startDeadlineMs", startDeadlineMs);
            o.put("lastFailed", orNull(lastFailed));
            o.put("lastError", orNull(lastError));
            o.put("entryClass", ENTRY_CLASS);
        } catch (Exception ignored) { }
        return o;
    }

    private static Object orNull(String s) { return s == null ? JSONObject.NULL : s; }

    // ── shell component forwarding (shell owns the component, payload owns the policy) ──

    /** Forward a shell-owned component (bound or, with null, unbound) to the active payload. */
    public void onShellComponent(String name, Object instance) {
        Payload p = active;
        if (p != null) try { p.onShellComponent(name, instance); } catch (Throwable t) { Log.w(TAG, "component forward threw: " + name, t); }
    }

    // ── internals ───────────────────────────────────────────────────────────

    /** Queue work on the worker thread. Null when the loader is shut down. */
    private Future<?> submit(Runnable work) {
        try {
            return exec.submit(() -> {
                try { work.run(); } catch (Throwable t) { Log.e(TAG, "loader operation failed", t); }
            });
        } catch (RejectedExecutionException shutDown) {
            return null;
        }
    }

    /** Wait until everything queued so far has run. For tests. */
    void awaitIdle(long timeoutMs) throws Exception {
        Future<?> f = submit(() -> { });
        if (f != null) f.get(timeoutMs, TimeUnit.MILLISECONDS);
    }

    /**
     * Start {@code jar}. If it cannot run, go to the previous payload, and if that
     * cannot run either (or there is none), to the baked payload. True when
     * {@code jar} itself is the one now running.
     */
    private boolean startOrFallBack(String jar) {
        if (start(jar)) return true;
        // A shutdown is not a failed payload: leave the pointers as they are.
        if (closed) return false;
        String to = null;
        try { to = store.rollback(); } catch (Exception e) { Log.e(TAG, "rollback after failed start also failed", e); }
        if (to != null && !to.equals(jar)) {
            shell.note("PAYLOAD", jar + " failed to start -> rollback to " + to + " (" + lastError + ")");
            if (start(to)) return false;
        }
        String name = ensureBakedFile();
        if (name != null && !name.equals(jar) && !name.equals(to)) {
            try {
                store.activate(name);
                shell.note("PAYLOAD", "no usable previous payload -> baked " + name + " (" + lastError + ")");
                if (start(name)) return false;
            } catch (Exception e) {
                Log.e(TAG, "baked fallback failed", e);
            }
        }
        shell.note("PAYLOAD", "no payload could be started (" + lastError + ")");
        return false;
    }

    /**
     * Load one jar and run its start() on a thread of its own, waiting at most the
     * start deadline. Returns false, with lastError and lastFailed set, when the
     * payload cannot be loaded, throws, or does not return in time.
     */
    private boolean start(final String jar) {
        if (closed) return false;
        starting = jar;
        try {
            final Payload p;
            try {
                p = source.open(new File(store.dir(), jar));
            } catch (Throwable t) {
                return failed(jar, t.getClass().getSimpleName() + ": " + t.getMessage(), t);
            }
            final FutureTask<Void> task = new FutureTask<>(() -> { p.start(shell); return null; });
            final boolean[] abandoned = { false };
            Thread runner = new Thread(() -> {
                task.run();
                // A start() that returns after it was given up on must not leave a payload running.
                boolean stop;
                synchronized (abandoned) { stop = abandoned[0]; }
                if (stop) stopSafely(p);
            }, "Daylight-payload-start");
            runner.setDaemon(true);
            runner.start();
            String problem = null;
            Throwable cause = null;
            try {
                task.get(startDeadlineMs, TimeUnit.MILLISECONDS);
            } catch (ExecutionException e) {
                cause = e.getCause() == null ? e : e.getCause();
                problem = cause.getClass().getSimpleName() + ": " + cause.getMessage();
            } catch (TimeoutException e) {
                problem = "start() did not return within " + startDeadlineMs + " ms";
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                problem = "loader shut down during start()";
            }
            if (problem == null && closed) problem = "loader shut down during start()";
            if (problem != null) {
                synchronized (abandoned) { abandoned[0] = true; }
                runner.interrupt();
                // Release what the payload holds so far (its port, its threads). stop() gets its
                // own thread: a payload stuck in start() may be stuck in stop() too.
                Thread stopper = new Thread(() -> stopSafely(p), "Daylight-payload-stop");
                stopper.setDaemon(true);
                stopper.start();
                return failed(jar, problem, cause);
            }
            active = p;
            activeJar = jar;
            lastError = null;
            Log.i(TAG, "payload ACTIVE " + jar + " v=" + safeVersion());
            return true;
        } finally {
            starting = null;
        }
    }

    private boolean failed(String jar, String problem, Throwable cause) {
        lastError = problem;
        lastFailed = jar;
        Log.e(TAG, "payload " + jar + " failed to load/start: " + problem, cause);
        active = null;
        activeJar = null;
        return false;
    }

    private static void stopSafely(Payload p) {
        try { p.stop(); } catch (Throwable t) { Log.w(TAG, "payload stop threw", t); }
    }

    private void unloadActive() {
        Payload p = active;
        if (p == null) return;
        stopSafely(p);
        active = null;
        // activeJar is kept until the next start so shutdown() can clear its crash counter.
    }

    /** The baked jar's name once it is on disk, extracting it when absent. Null when the APK has none. */
    private String ensureBakedFile() {
        String name = bakedName();
        if (new File(store.dir(), name).isFile()) return name;
        try {
            extractBaked(name);
            return name;
        } catch (Exception e) {
            lastError = "baked payload unavailable: " + e.getMessage();
            Log.e(TAG, lastError);
            return null;
        }
    }

    /** Extract to a temp file, then rename, so a half-written jar never carries the baked name. */
    private void extractBaked(String name) throws Exception {
        File part = new File(store.dir(), name + ".part");
        try {
            baked.extractTo(part);
            Files.move(part.toPath(), new File(store.dir(), name).toPath(), StandardCopyOption.REPLACE_EXISTING);
        } finally {
            part.delete();
        }
    }

    private static PayloadSource dexSource(final Context ctx) {
        return jar -> {
            File opt = new File(ctx.getCodeCacheDir(), "payload-opt");
            if (!opt.exists()) opt.mkdirs();
            // Parent = the shell's class loader, so the payload resolves ShellServices,
            // NanoHTTPD and org.json from the APK. A payload bundles no libraries.
            DexClassLoader cl = new DexClassLoader(jar.getAbsolutePath(), opt.getAbsolutePath(), null, ctx.getClassLoader());
            return (Payload) cl.loadClass(ENTRY_CLASS).getDeclaredConstructor().newInstance();
        };
    }

    private static BakedPayload assetPayload(final Context ctx) {
        return dst -> {
            try (InputStream in = ctx.getAssets().open(BAKED_ASSET); FileOutputStream out = new FileOutputStream(dst)) {
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            }
        };
    }

    private static void download(String url, File dst) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(60000);
        try (InputStream in = c.getInputStream(); FileOutputStream out = new FileOutputStream(dst)) {
            checkDeclaredLength(c.getContentLengthLong(), MAX_PAYLOAD_BYTES);
            copyCapped(in, out, MAX_PAYLOAD_BYTES);
        } finally {
            c.disconnect();
        }
    }

    /** Refuse a download whose declared length is over the limit. A length of -1 means none was declared. */
    static void checkDeclaredLength(long declared, long limit) throws java.io.IOException {
        net.kckern.daylight.api.CappedCopy.checkDeclaredLength(declared, limit, "payload");
    }

    /** Copy until the stream ends, giving up once more than the limit has arrived. Returns the byte count. */
    static long copyCapped(InputStream in, java.io.OutputStream out, long limit) throws java.io.IOException {
        return net.kckern.daylight.api.CappedCopy.copy(in, out, limit, "payload");
    }

    private String safeVersion() {
        try { Payload p = active; return p == null ? "?" : p.version(); } catch (Throwable t) { return "?"; }
    }
}
