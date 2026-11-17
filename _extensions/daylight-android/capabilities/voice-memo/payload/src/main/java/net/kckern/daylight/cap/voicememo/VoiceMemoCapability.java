package net.kckern.daylight.cap.voicememo;

import android.content.Context;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;

import net.kckern.daylight.api.PayloadPort;
import net.kckern.daylight.api.PayloadState;
import net.kckern.daylight.core.Capability;
import net.kckern.daylight.core.CoreContext;
import net.kckern.daylight.core.LinkEffect;
import net.kckern.daylight.core.Replies;
import net.kckern.daylight.core.Router;
import net.kckern.daylight.core.backend.Backend;
import net.kckern.daylight.core.backend.BackendHttp;
import net.kckern.daylight.core.backend.Http;
import net.kckern.daylight.core.spi.LinkHandler;
import net.kckern.daylight.core.spi.LocalNotices;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.LongSupplier;

/**
 * Voice memos for the Journalist: the queue and the upload. Recording is installed
 * code (the shell half), so a memo can be captured while the payload is being
 * swapped; a finished recording is a file in the inbox, which this capability finds,
 * queues on disk and uploads, one at a time, when a network is up.
 *
 * The audio of a memo leaves the phone in one request to the backend and is deleted
 * only after the backend answered 200 for it. Nothing here reads the audio, and no
 * log line or notice holds more than a memo's id, its size and its state.
 *
 * Recording starts from one place: the keyed link daylight://memo/new, which only
 * this app's own surfaces (a tile, the widget, a shortcut) can build. A page of the
 * site cannot start the microphone.
 */
public final class VoiceMemoCapability implements Capability {
    /** The PayloadPort the recorder tells of a finished recording. The shell half spells the same name (MemoFiles.PORT). */
    static final String PORT = "memos";
    static final String WORKER = "Daylight-memo-upload";
    private static final String RECORD_ACTIVITY = "net.kckern.daylight.cap.voicememo.shell.RecordActivity";
    /** With nothing due, look again this often anyway (a recording made while no payload was loaded). */
    private static final long IDLE_MS = 15 * 60_000L;

    /** Opens the installed record screen. */
    interface Recorder { void open(); }

    private CoreContext core;
    private Backend backend;
    private Http http;
    private File stateDir;
    private File inbox;
    private LongSupplier clock;
    private UploadPump.Link link;
    private Recorder recorder;

    private volatile MemoQueue queue;
    private volatile UploadPump pump;
    private volatile Thread loop;
    private final Object wake = new Object();
    private boolean woken;
    private volatile String blocked = "";
    private String lastAnnounced = "";
    private Object networkCallback;

    private final PayloadPort port = PayloadPort.named(PORT);
    private final PayloadPort.Handler onCall = request -> {
        String op;
        try { op = new JSONObject(request).optString("op", ""); }
        catch (Exception notJson) { op = ""; }
        if (!"recorded".equals(op)) return Replies.err("bad_request").toString();
        return Replies.ok().put("waiting", recorded()).toString();
    };

    public VoiceMemoCapability() { }

    VoiceMemoCapability(Http http, File stateDir, File inbox, LongSupplier clock, UploadPump.Link link, Recorder recorder) {
        this.http = http;
        this.stateDir = stateDir;
        this.inbox = inbox;
        this.clock = clock;
        this.link = link;
        this.recorder = recorder;
    }

    @Override public String name() { return "voice-memo"; }

    @Override public void register(final CoreContext core) {
        this.core = core;
        this.backend = Backend.from(core);
        if (http == null) http = new BackendHttp(backend::deviceHeader);
        if (clock == null) clock = System::currentTimeMillis;

        core.services().provide(LinkHandler.class, new LinkHandler() {
            @Override public String kind() { return "memo"; }
            @Override public JSONObject handle(String arg, Map<String, String> query) throws Exception {
                // The query is whatever the sender of the link wrote, and is not read.
                if ("new".equals(arg)) return startRecording();
                if ("queue".equals(arg)) return tryAgain();
                throw new IllegalArgumentException("expected memo/new or memo/queue");
            }
        });

        core.router().route("GET", "/memo/queue", req -> {
            MemoQueue q = queueOrNull();
            JSONObject body = q == null
                    ? Replies.ok().put("waiting", 0).put("parked", 0).put("uploaded", 0).put("lost", 0).put("memos", new JSONArray())
                    : q.describe();
            return Router.Response.json(200, body.put("blocked", blocked).put("problems", new JSONArray(problems())));
        });
        core.router().route("POST", "/memo/recorded", req -> Router.Response.json(200, Replies.ok().put("waiting", recorded())));
        core.router().route("POST", "/memo/retry", req -> {
            MemoQueue q = requireQueue();
            q.retryAll(clock.getAsLong());
            wake();
            return Router.Response.json(200, Replies.ok().put("waiting", q.waiting()));
        });
    }

    /**
     * Never throws on a setting: a missing identity is a problem in GET /memo/queue and
     * a notice once a memo is kept. With no Android context (a JVM test of the whole
     * payload) there is no inbox and nothing starts.
     */
    @Override public void start() {
        if (queueOrNull() == null) return;
        for (String problem : problems()) core.shell().note("MEMO", problem);
        Thread t = new Thread(this::run, WORKER);
        t.setDaemon(true);
        loop = t;
        t.start();
        watchNetwork();
        port.attach(onCall);
    }

    /**
     * May be called twice. An upload under way is not waited for: it can take five
     * minutes. It finishes by itself and then touches nothing (UploadPump.stop).
     */
    @Override public void stop() {
        port.detach(onCall);
        UploadPump p = pump;
        if (p != null) p.stop();
        Thread t = loop;
        loop = null;
        if (t != null) t.interrupt();
        unwatchNetwork();
    }

    // ── the queue ─────────────────────────────────────────────────────────────

    /** The queue, made on first use; null when there is nowhere to keep one (no Android context). */
    private synchronized MemoQueue queueOrNull() {
        if (queue != null) return queue;
        if (inbox == null || stateDir == null) {
            Object context = core.shell().context();
            if (context == null) return null;
            if (inbox == null) inbox = new File(((Context) context).getFilesDir(), MemoInbox.DIR);
            if (stateDir == null) stateDir = PayloadState.dir(core.shell().payloadDir());
        }
        inbox.mkdirs();
        if (link == null) link = this::networkUp;
        MemoQueue q = new MemoQueue(new File(stateDir, "memo-queue.json"));
        pump = new UploadPump(q, new MemoUploader(backend, http), link);
        queue = q;
        return q;
    }

    private MemoQueue requireQueue() {
        MemoQueue q = queueOrNull();
        if (q == null) throw new net.kckern.daylight.core.UnsupportedException("voice memos need a running app");
        return q;
    }

    File inbox() { queueOrNull(); return inbox; }

    /** The recorder finished a file: queue it and send it now. */
    private int recorded() {
        MemoQueue q = requireQueue();
        MemoInbox.scan(inbox, q);
        wake();
        return q.waiting();
    }

    /** One pass: pick up new recordings, upload what is due, tell the owner what is left. */
    void pumpOnce() {
        MemoQueue q = requireQueue();
        long now = clock.getAsLong();
        MemoInbox.sweepCutOff(inbox, now);
        MemoInbox.scan(inbox, q);
        UploadPump.Pass pass = pump.drain(now);
        blocked = pass.blocked;
        for (int i = 0; i < pass.uploadedIds.size(); i++) {
            core.shell().note("MEMO", "uploaded " + pass.uploadedIds.get(i) + " " + pass.sizes.get(i) + " bytes");
        }
        if (pass.parked > 0) core.shell().note("MEMO", "parked " + pass.parked + ", " + q.parked() + " in all");
        if (pass.lost > 0) core.shell().note("MEMO", pass.lost + " recording(s) were gone before they could be sent");
        announce(q);
    }

    /** When the upload thread should look again, or -1 for "only when something changes". */
    long nextWakeAtMs() {
        MemoQueue q = queue;
        // With no identity nothing can be sent however often it is tried.
        if (q == null || !blocked.isEmpty()) return -1;
        return q.nextAttemptAtMs();
    }

    private void run() {
        while (!Thread.currentThread().isInterrupted() && loop == Thread.currentThread()) {
            try {
                pumpOnce();
                long next = nextWakeAtMs();
                long wait = next < 0 ? IDLE_MS : Math.max(1000, Math.min(next - clock.getAsLong(), IDLE_MS));
                synchronized (wake) {
                    if (!woken) wake.wait(wait);
                    woken = false;
                }
            } catch (InterruptedException stopping) {
                return;
            } catch (RuntimeException e) {
                core.shell().note("MEMO", "upload pass failed: " + e.getClass().getSimpleName());
                try { Thread.sleep(5000); } catch (InterruptedException stopping) { return; }
            }
        }
    }

    private void wake() {
        synchronized (wake) {
            woken = true;
            wake.notifyAll();
        }
    }

    /** A local notice through the notifications capability; nothing when it is absent. Said once per state. */
    private synchronized void announce(MemoQueue q) {
        QueueNotice notice = QueueNotice.of(q.waiting(), q.parked(), blocked);
        String key = notice == null ? "" : notice.key();
        if (key.equals(lastAnnounced)) return;
        LocalNotices notices = core.services().find(LocalNotices.class);
        if (notices == null) return;
        try {
            if (notice == null) notices.cancel(QueueNotice.ID);
            else notices.post(QueueNotice.ID, LocalNotices.UPLOADS, notice.title, notice.text, notice.link);
            lastAnnounced = key;
        } catch (RuntimeException e) {
            core.shell().note("MEMO", "could not show the queue's notice: " + e.getClass().getSimpleName());
        }
    }

    // ── links ─────────────────────────────────────────────────────────────────

    private JSONObject startRecording() throws Exception {
        // A memo that could never be sent is not recorded in the first place.
        if (backend.user().isEmpty()) {
            return LinkEffect.toast("Voice memos are not set up on this phone: " + MemoUploader.IDENTITY_NOT_CONFIGURED);
        }
        Recorder r = recorder();
        if (r == null) return LinkEffect.toast("Not available on this device");
        r.open();
        core.shell().note("MEMO", "record screen opened");
        return LinkEffect.none();
    }

    private JSONObject tryAgain() throws Exception {
        MemoQueue q = queueOrNull();
        if (q == null) return LinkEffect.toast("Not available on this device");
        int kept = q.waiting() + q.parked();
        if (kept == 0) return LinkEffect.toast("No voice memos are waiting");
        if (backend.user().isEmpty()) {
            return LinkEffect.toast("Voice memos are not set up on this phone: " + MemoUploader.IDENTITY_NOT_CONFIGURED);
        }
        q.retryAll(clock.getAsLong());
        wake();
        return LinkEffect.toast("Trying again: " + QueueNotice.memos(kept));
    }

    private Recorder recorder() {
        if (recorder == null) {
            final Object context = core.shell().context();
            if (context == null) return null;
            recorder = () -> {
                Context c = (Context) context;
                // By name: the record screen is installed code in this capability's shell half.
                // It is not exported, so only this app can start it. Started while the link
                // activity is on screen, which is what lets a service context start one.
                c.startActivity(new Intent().setClassName(c, RECORD_ACTIVITY).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            };
        }
        return recorder;
    }

    private List<String> problems() {
        List<String> out = new ArrayList<>();
        if (backend.user().isEmpty()) out.add("identity.user is not set: voice memos cannot be sent");
        if (!backend.configured()) out.add(MemoUploader.SITE_NOT_SET);
        return out;
    }

    // ── network ───────────────────────────────────────────────────────────────

    /** True when a network with internet is up, and when Android cannot say (then the request itself finds out). */
    private boolean networkUp() {
        try {
            Object context = core.shell().context();
            ConnectivityManager cm = context == null ? null
                    : (ConnectivityManager) ((Context) context).getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return true;
            Network active = cm.getActiveNetwork();
            if (active == null) return false;
            NetworkCapabilities caps = cm.getNetworkCapabilities(active);
            return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
        } catch (RuntimeException unknown) {
            return true;
        }
    }

    /** Wake the queue the moment a network comes up, which is when the VPN can return. */
    private void watchNetwork() {
        try {
            Object context = core.shell().context();
            ConnectivityManager cm = context == null ? null
                    : (ConnectivityManager) ((Context) context).getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return;
            ConnectivityManager.NetworkCallback callback = new ConnectivityManager.NetworkCallback() {
                @Override public void onAvailable(Network network) { wake(); }
            };
            cm.registerDefaultNetworkCallback(callback);
            networkCallback = callback;
        } catch (RuntimeException e) {
            core.shell().note("MEMO", "no network callback, relying on the timer: " + e.getClass().getSimpleName());
        }
    }

    private void unwatchNetwork() {
        Object callback = networkCallback;
        networkCallback = null;
        if (callback == null) return;
        try {
            Object context = core.shell().context();
            ((ConnectivityManager) ((Context) context).getSystemService(Context.CONNECTIVITY_SERVICE))
                    .unregisterNetworkCallback((ConnectivityManager.NetworkCallback) callback);
        } catch (RuntimeException ignored) { }
    }
}
