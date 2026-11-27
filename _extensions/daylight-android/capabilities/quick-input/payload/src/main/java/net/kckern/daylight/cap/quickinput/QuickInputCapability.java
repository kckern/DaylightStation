package net.kckern.daylight.cap.quickinput;

import android.content.Context;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;

import net.kckern.daylight.api.PayloadPort;
import net.kckern.daylight.api.PayloadState;
import net.kckern.daylight.cap.quickinput.shell.CaptureScope;
import net.kckern.daylight.core.Capability;
import net.kckern.daylight.core.CoreContext;
import net.kckern.daylight.core.LinkEffect;
import net.kckern.daylight.core.Replies;
import net.kckern.daylight.core.Router;
import net.kckern.daylight.core.SettingsRegistry;
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
import java.util.function.Predicate;
import java.util.function.Supplier;

/**
 * Quick inputs: a recording, typed text or a photo, captured on the phone and sent to
 * one of the configured destinations (the Journalist, Nutribot). This is the queue and
 * the upload. Capturing is installed code (the shell half), so an input can be made
 * while the payload is being swapped; a finished input is a file in an inbox, which
 * this capability finds, queues on disk and uploads, one at a time, when a network is up.
 *
 * What was captured leaves the phone in one request to the backend and is deleted only
 * after the backend answered 200 for it. Nothing here reads it, and no log line or
 * notice holds more than an input's id, its kind, its destination, its size and its state.
 *
 * A capture (the recorder, the camera, the text screen) starts from one place: a keyed
 * link, daylight://input/<kind>?to=<destination> or its earlier name daylight://memo/new,
 * which only this app's own surfaces (a tile, the widget, a shortcut) can build. A page
 * of the site, a link from another app and a car cannot start one. What a page may do
 * with the microphone itself is the web view's rule (webview.allowMic, and how the page
 * was opened).
 */
public final class QuickInputCapability implements Capability {
    /** The PayloadPort the recorder tells of a finished recording. The shell half spells the same name (MemoFiles.PORT). */
    static final String PORT = "inputs";
    /** The queue's state, under the payload's state directory. */
    static final String STATE_FILE = "input-queue.json";
    /** What the same file was called before there were destinations. It is carried over once. */
    static final String OLD_STATE_FILE = "memo-queue.json";
    static final String WORKER = "Daylight-memo-upload";
    /** input.dest.1 to input.dest.8: one destination a line (Destinations). */
    static final String DEST = "input.dest.";
    private static final String RECORD_ACTIVITY = "net.kckern.daylight.cap.quickinput.shell.RecordActivity";
    private static final String TEXT_ACTIVITY = "net.kckern.daylight.cap.quickinput.shell.TextInputActivity";
    /** The meal camera; it opens the phone's camera app itself when the camera permission is refused. */
    private static final String PHOTO_ACTIVITY = "net.kckern.daylight.cap.quickinput.shell.MealCameraActivity";
    /** The extras a capture screen is started with (MemoFiles.EXTRA_DEST and EXTRA_LABEL in the shell half). */
    static final String EXTRA_DEST = "dest";
    static final String EXTRA_LABEL = "label";
    /** With nothing due, look again this often anyway (a recording made while no payload was loaded). */
    private static final long IDLE_MS = 15 * 60_000L;

    /**
     * Opens one of the installed capture screens for a destination. Each takes the
     * destination's id and its label and nothing else: never a route.
     */
    interface Screens {
        void record(String dest, String label);
        void text(String dest, String label);
        void photo(String dest, String label);
        default void launch(Destinations.Kind kind, String dest, String label, String owner) {
            switch (kind) {
                case TEXT: text(dest, label); break;
                case PHOTO: photo(dest, label); break;
                default: record(dest, label); break;
            }
        }
    }

    /**
     * Asks the installed recorder to recover recordings that were cut off. It alone
     * knows whether a recording is under way, so the decision is its own (MemoRecovery
     * in the shell half). Answers {recovered, unplayable}.
     */
    interface Recovery { int[] recover(); }

    static final String CUT_OFF_NOTICE = "memo-cutoff";
    static final String NOT_SET_UP = "Quick inputs are not set up on this phone: ";
    /** A second tap on Discard within this long deletes; the first only asks. */
    static final long DISCARD_CONFIRM_MS = 20_000L;

    private CoreContext core;
    private Backend backend;
    private final Supplier<String> captureOwner = () -> InputUploader.currentScope(backend);
    private Http http;
    private File stateDir;
    private File inbox;
    private LongSupplier clock;
    private UploadPump.Link link;
    private Screens screens;

    private volatile InputQueue queue;
    private volatile UploadPump pump;
    private volatile Thread loop;
    private final Object wake = new Object();
    private boolean woken;
    private volatile String blocked = "";
    /** Destinations the backend answered this phone may not send to for the user yet. Each is cleared by its first success. */
    private final java.util.Set<String> notAllowed = java.util.Collections.synchronizedSet(new java.util.LinkedHashSet<String>());
    /** Where the text and photo screens leave what they captured. */
    File inputsInbox;
    private String lastAnnounced = "";
    private final java.util.Set<String> canceledCaptures = new java.util.HashSet<>();
    private int cutOffAnnounced;
    private File cutOffDir;
    Recovery recovery;
    private long discardArmedAtMs;
    private String discardArmedOwner;
    private Object networkCallback;

    private static final String STATUS_ACTIVITY = "net.kckern.daylight.cap.quickinput.shell.CaptureStatusActivity";
    private final PayloadPort port = PayloadPort.named(PORT);
    private final PayloadPort.Handler onCall = request -> {
        JSONObject body;
        try { body = new JSONObject(request); }
        catch (org.json.JSONException invalid) { return Replies.err("bad_request").toString(); }
        String op = body.optString("op");
        if ("recorded".equals(op)) return Replies.ok().put("waiting", recorded()).toString();
        String owner = captureOwner.get();
        if (!"status".equals(op) && !"retry".equals(op) && !"replace".equals(op)
                && !"view".equals(op) && !"health".equals(op) && !"share-targets".equals(op)) return Replies.err("bad_request").toString();
        if (owner == null || !owner.equals(body.optString("owner"))) return Replies.err("account_unavailable").toString();
        // The share sheet's choices: ids and labels only, never a route.
        if ("share-targets".equals(op)) return shareTargets().toString();
        InputQueue q = requireQueue();
        switch (op) {
            case "status":
                return captureStatus(q, owner).toString();
            case "retry":
                return retryCapture(q, owner, body.optString("id")).toString();
            case "replace":
                return replaceCapture(q, owner, body.optString("id")).toString();
            case "view": {
                JSONObject row = captureRow(q, owner, body.optString("id"));
                String date = row == null ? "" : row.optString("entryDate");
                String logId = row == null ? "" : row.optString("entryId");
                if (!date.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}") || !logId.matches("[0-9a-f-]{36}")) {
                    return Replies.err("capture_unavailable").toString();
                }
                return openHealth("/health?date=" + date + "&mealLog=" + logId).toString();
            }
            case "health":
                return openHealth("/health?capture=status").toString();
            default:
                return Replies.err("bad_request").toString();
        }
    };

    public QuickInputCapability() { }

    QuickInputCapability(Http http, File stateDir, File inbox, LongSupplier clock, UploadPump.Link link, Screens screens) {
        this.http = http;
        this.stateDir = stateDir;
        this.inbox = inbox;
        this.clock = clock;
        this.link = link;
        this.screens = screens;
    }

    @Override public String name() { return "quick-input"; }

    @Override public void register(final CoreContext core) {
        this.core = core;
        this.backend = Backend.from(core);
        if (http == null) http = new BackendHttp(backend::deviceHeader);
        if (clock == null) clock = System::currentTimeMillis;
        // Where an input goes. The first slots default to the intake contract's table; a
        // line that names anything but a plain path under /api/v1/ is refused when set.
        for (int i = 1; i <= Destinations.SLOTS; i++) {
            core.settings().declare(DEST + i, SettingsRegistry.Type.STRING,
                    i <= Destinations.DEFAULTS.length ? Destinations.DEFAULTS[i - 1] : "",
                    value -> Destinations.problem((String) value));
        }

        // daylight://input/<voice|text|photo>?to=<destination id>, input/queue, input/discard.
        core.services().provide(LinkHandler.class, new KeyedOnly("input") {
            @Override public JSONObject handle(String arg, Map<String, String> query) throws Exception {
                if ("status".equals(arg)) {
                    String owner = captureOwner.get();
                    String stated = query == null ? null : query.get("owner");
                    String id = query == null ? null : query.get("id");
                    String action = query == null ? null : query.get("do");
                    if (stated != null && !stated.equals(owner)) return LinkEffect.toast("This capture belongs to another account");
                    if (action != null && stated != null && id != null) {
                        if ("retry".equals(action)) retryCapture(requireQueue(), owner, id);
                        if ("replace".equals(action)) return replaceCapture(requireQueue(), owner, id);
                    }
                    return openCaptureStatus(id, owner);
                }
                if ("queue".equals(arg)) return tryAgain();
                if ("discard".equals(arg)) return discard();
                Destinations.Kind kind = Destinations.Kind.of(arg);
                // Of the query only "to" is read, and only as the id of a configured destination.
                String to = query == null ? null : query.get("to");
                if (kind == null || to == null) throw new IllegalArgumentException("expected input/<voice|text|photo>?to=<destination>");
                return startInput(kind, to);
            }
        });
        // The earlier name: memo/new is a voice input for the journal.
        core.services().provide(LinkHandler.class, new KeyedOnly("memo") {
            @Override public JSONObject handle(String arg, Map<String, String> query) throws Exception {
                // The query is whatever the sender of the link wrote, and is not read.
                if ("new".equals(arg)) return startInput(Destinations.Kind.VOICE, Destinations.MEMO_DESTINATION);
                if ("queue".equals(arg)) return tryAgain();
                if ("discard".equals(arg)) return discard();
                throw new IllegalArgumentException("expected memo/new, memo/queue or memo/discard");
            }
        });

        core.router().route("GET", "/input/queue", req -> {
            InputQueue q = queueOrNull();
            JSONObject body = q == null
                    ? Replies.ok().put("waiting", 0).put("parked", 0).put("uploaded", 0).put("lost", 0).put("inputs", new JSONArray())
                    : q.describe(captureOwner.get(), false);
            JSONArray refused;
            synchronized (notAllowed) { refused = new JSONArray(notAllowed); }
            return Router.Response.json(200, body.put("blocked", blocked).put("notAllowed", refused)
                    .put("cutOffKept", cutOffDir == null ? 0 : InputInbox.cutOffKept(cutOffDir))
                    .put("destinations", describeDestinations())
                    .put("problems", new JSONArray(problems())));
        });
        core.router().route("GET", "/input/status", req -> {
            InputQueue q = queueOrNull();
            String owner = captureOwner.get();
            JSONObject view = q == null || owner == null ? Replies.ok().put("inputs", new JSONArray())
                    : captureStatus(q, owner);
            return Router.Response.json(200, view);
        });
        core.router().route("POST", "/input/recorded", req -> Router.Response.json(200, Replies.ok().put("waiting", recorded())));
        core.router().route("POST", "/input/status/retry", req -> {
            String owner = captureOwner.get();
            String id = req.query.get("id");
            JSONObject result = owner != null && id != null && InputInbox.ID.matcher(id).matches()
                    ? retryCapture(requireQueue(), owner, id) : Replies.err("capture_unavailable");
            return Router.Response.json(result.optBoolean("ok") ? 200 : 409, result);
        });
        core.router().route("POST", "/input/retry", req -> {
            InputQueue q = requireQueue();
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
        for (String problem : problems()) core.shell().note("INPUT", problem);
        Thread t = new Thread(this::run, WORKER);
        t.setDaemon(true);
        loop = t;
        t.start();
        watchNetwork();
        port.attach(onCall);
        try { CaptureScope.attach(captureOwner); } catch (LinkageError olderShell) { }
    }

    /**
     * May be called twice. An upload under way is not waited for: it can take five
     * minutes. It finishes by itself and then touches nothing (UploadPump.stop).
     */
    @Override public void stop() {
        try { CaptureScope.detach(captureOwner); } catch (LinkageError olderShell) { }
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
    private synchronized InputQueue queueOrNull() {
        if (queue != null) return queue;
        if (inbox == null || stateDir == null) {
            Object context = core.shell().context();
            if (context == null) return null;
            final File filesDir = ((Context) context).getFilesDir();
            if (inbox == null) inbox = new File(filesDir, InputInbox.DIR);
            if (inputsInbox == null) inputsInbox = new File(filesDir, InputInbox.INPUTS_DIR);
            if (stateDir == null) stateDir = PayloadState.dir(core.shell().payloadDir());
            if (cutOffDir == null) cutOffDir = new File(filesDir, InputInbox.CUT_OFF_DIR);
            if (recovery == null) {
                recovery = () -> {
                    net.kckern.daylight.cap.quickinput.shell.MemoRecovery.Found f =
                            net.kckern.daylight.cap.quickinput.shell.MemoRecovery.recoverNow(filesDir);
                    return new int[] { f.recovered, f.unplayable };
                };
            }
        }
        if (cutOffDir == null) cutOffDir = new File(inbox.getParentFile(), "cutoff");
        if (inputsInbox == null) inputsInbox = new File(inbox.getParentFile(), "inputs-inbox");
        inbox.mkdirs();
        inputsInbox.mkdirs();
        if (link == null) link = this::networkUp;
        File state = new File(stateDir, STATE_FILE);
        File before = new File(stateDir, OLD_STATE_FILE);
        // The queue of the build before destinations: the same entries, read as voice memos for the journal.
        if (!state.exists() && before.isFile() && !before.renameTo(state)) state = before;
        InputQueue q = new InputQueue(state);
        pump = new UploadPump(q, new InputUploader(backend, http, () -> destinations(null)), link, this::canClaim);
        queue = q;
        return q;
    }

    private InputQueue requireQueue() {
        InputQueue q = queueOrNull();
        if (q == null) throw new net.kckern.daylight.core.UnsupportedException("quick inputs need a running app");
        return q;
    }

    private boolean canClaim(InputQueue.Entry entry) {
        return InputUploader.allowsFile(new File(entry.file), captureOwner.get());
    }

    File inbox() { queueOrNull(); return inbox; }

    /** Both inboxes: the recorder's, and the one the text and photo screens write to. */
    private void scan(InputQueue q) {
        InputInbox.scan(inbox, q);
        InputInbox.scan(inputsInbox, q);
        String owner = captureOwner.get();
        if (owner != null) {
            InputInbox.scan(CaptureScope.inbox(inbox, owner), q);
            InputInbox.scan(CaptureScope.inbox(inputsInbox, owner), q);
        }
    }

    /** A capture finished a file: queue it and send it now. */
    private int recorded() {
        InputQueue q = requireQueue();
        scan(q);
        wake();
        return q.waiting();
    }

    /** One pass: pick up new recordings, upload what is due, tell the owner what is left. */
    void pumpOnce() {
        InputQueue q = requireQueue();
        long now = clock.getAsLong();
        recoverCutOff();
        int swept = InputInbox.sweepParts(inputsInbox, now);
        if (swept > 0) core.shell().note("INPUT", swept + " unfinished capture(s) removed");
        scan(q);
        UploadPump.Pass pass = pump.drain(now);
        blocked = pass.blocked;
        notAllowed.removeAll(pass.uploadedDests);
        notAllowed.addAll(pass.notAllowedDests);
        for (java.util.Map.Entry<String, Long> limit : pass.limits.entrySet()) {
            core.shell().note("INPUT", "the daily allowance for " + limit.getKey() + " is used up; nothing is sent to it for "
                    + ((limit.getValue() - now) / 60_000) + " min");
        }
        if (pass.uploaded > 0) core.shell().note("INPUT", pass.uploaded + " capture(s) accepted");
        if (pass.parked > 0) core.shell().note("INPUT", "parked " + pass.parked + ", " + q.parked() + " in all");
        if (pass.lost > 0) core.shell().note("INPUT", pass.lost + " input(s) were gone before they could be sent");
        announce(q);
        announceCaptures(q);
    }

    /**
     * A recording whose recorder is gone (the app was killed) is never deleted. The
     * installed recorder turns what can be played into a finished memo, which the scan
     * that follows queues with the start time in its id, and moves the rest to
     * memos/cutoff. The owner is told once how many are kept there.
     */
    private void recoverCutOff() {
        Recovery r = recovery;
        if (r != null) {
            try {
                int[] found = r.recover();
                if (found[0] + found[1] > 0) {
                    core.shell().note("INPUT", "cut-off recordings: " + found[0] + " recovered, " + found[1] + " kept aside as unplayable");
                }
            } catch (RuntimeException | LinkageError olderShellOrBroken) {
                // An installed shell from before recovery existed: nothing is recovered and nothing is removed.
                core.shell().note("INPUT", "cut-off recordings were not looked for: " + olderShellOrBroken.getClass().getSimpleName());
                recovery = null;
            }
        }
        int kept = InputInbox.cutOffKept(cutOffDir);
        if (kept == cutOffAnnounced) return;
        LocalNotices notices = core.services().find(LocalNotices.class);
        if (notices == null) return;
        try {
            if (kept == 0) notices.cancel(CUT_OFF_NOTICE);
            else notices.post(CUT_OFF_NOTICE, LocalNotices.UPLOADS, "Voice memos",
                    kept + (kept == 1 ? " recording was" : " recordings were") + " cut off and cannot be played. "
                            + (kept == 1 ? "It is" : "They are") + " kept on this phone and not sent.", "");
            cutOffAnnounced = kept;
        } catch (RuntimeException e) {
            core.shell().note("INPUT", "could not show the cut-off notice: " + e.getClass().getSimpleName());
        }
    }

    /** When the upload thread should look again, or -1 for "only when something changes". */
    long nextWakeAtMs() {
        InputQueue q = queue;
        // With no identity nothing can be sent however often it is tried.
        if (q == null || !blocked.isEmpty()) return -1;
        return q.nextAttemptAtMs(this::canClaim);
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
                core.shell().note("INPUT", "upload pass failed: " + e.getClass().getSimpleName());
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
    private synchronized void announce(InputQueue q) {
        Destinations dests = destinations(null);
        // A notice names a destination by its label, and never holds anything of an input.
        List<String> refused = new ArrayList<>();
        synchronized (notAllowed) {
            for (String id : notAllowed) if (q.waitingByDest().containsKey(id)) refused.add(dests.label(id));
        }
        java.util.Map<String, Long> limits = new java.util.LinkedHashMap<>();
        for (java.util.Map.Entry<String, Long> hold : q.holds(clock.getAsLong()).entrySet()) {
            if (q.waitingByDest().containsKey(hold.getKey())) limits.put(dests.label(hold.getKey()), hold.getValue());
        }
        QueueNotice notice = QueueNotice.of(labelled(q.waitingByDest(), dests), labelled(q.parkedByDest(), dests), blocked, refused, limits);
        String key = notice == null ? "" : notice.key();
        if (key.equals(lastAnnounced)) return;
        LocalNotices notices = core.services().find(LocalNotices.class);
        if (notices == null) return;
        try {
            if (notice == null) notices.cancel(QueueNotice.ID);
            else notices.post(QueueNotice.ID, LocalNotices.UPLOADS, notice.title, notice.text, notice.link,
                    notice.actionLabel, notice.actionLink);
            lastAnnounced = key;
        } catch (RuntimeException e) {
            core.shell().note("INPUT", "could not show the queue's notice: " + e.getClass().getSimpleName());
        }
    }

    private synchronized void announceCaptures(InputQueue q) {
        LocalNotices notices = core.services().find(LocalNotices.class);
        if (notices == null) return;
        String owner = captureOwner.get();
        long now = clock.getAsLong();
        try {
            for (Map.Entry<String, JSONArray> entry : q.otherCaptureStatuses(owner, now).entrySet()) {
                JSONArray rows = entry.getValue();
                for (int i = 0; i < rows.length(); i++) {
                    String id = QueueNotice.captureId(entry.getKey(), rows.getJSONObject(i).getString("id"));
                    if (!canceledCaptures.contains(id)) {
                        notices.cancel(id);
                        canceledCaptures.add(id);
                    }
                }
            }
            if (owner == null) return;
            JSONArray rows = captureStatus(q, owner).optJSONArray("inputs");
            if (rows == null) return;
            for (int i = 0; i < rows.length(); i++) {
                if (!owner.equals(captureOwner.get())) return;
                JSONObject row = rows.getJSONObject(i);
                String inputId = row.getString("id");
                String id = QueueNotice.captureId(owner, inputId);
                String state = row.getString("state");
                String previous = q.captureNoticeState(id);
                if (state.equals(previous)) continue;
                String action = row.getString("action");
                String link = QueueNotice.captureLink(owner, inputId, "");
                String actionLink = "";
                if ("Retry".equals(action)) actionLink = QueueNotice.captureLink(owner, inputId, "&do=retry");
                if ("Replace capture".equals(action)) actionLink = QueueNotice.captureLink(owner, inputId, "&do=replace");
                // Record first so an interruption after post cannot replay a historical alert.
                if (!q.rememberCaptureNotice(id, state)) return;
                try {
                    if (!owner.equals(captureOwner.get())) {
                        q.rememberCaptureNotice(id, previous);
                        return;
                    }
                    notices.post(id, LocalNotices.UPLOADS, row.getString("destination"), row.getString("message"), link,
                            actionLink.isEmpty() ? "" : action, actionLink);
                    canceledCaptures.remove(id);
                } catch (RuntimeException unavailable) {
                    q.rememberCaptureNotice(id, previous);
                    throw unavailable;
                }
            }
        } catch (Exception unavailable) {
            core.shell().note("INPUT", "could not show a capture notice");
        }
    }

    /** Counts by destination id, as counts by the destination's label. */
    private static java.util.Map<String, Integer> labelled(java.util.Map<String, Integer> byDest, Destinations dests) {
        java.util.Map<String, Integer> out = new java.util.LinkedHashMap<>();
        for (java.util.Map.Entry<String, Integer> e : byDest.entrySet()) {
            String label = dests.label(e.getKey());
            Integer n = out.get(label);
            out.put(label, (n == null ? 0 : n) + e.getValue());
        }
        return out;
    }

    // ── links ─────────────────────────────────────────────────────────────────

    /**
     * A link handler that does nothing for a link that came from outside the app without
     * this install's key. The notifications capability already refuses such a link for
     * these kinds; this holds even if that list were ever changed.
     */
    private abstract static class KeyedOnly implements LinkHandler {
        private final String kind;
        KeyedOnly(String kind) { this.kind = kind; }
        @Override public String kind() { return kind; }
        @Override public JSONObject handle(String arg, Map<String, String> query, boolean keyed) throws Exception {
            if (!keyed) return LinkEffect.refused("forbidden", "That link has expired. Try it again from the app.");
            return handle(arg, query);
        }
    }

    /**
     * Opens the capture screen of a kind for a destination. The destination is one of
     * the configured lines, named by its id, and must take that kind: nothing in a link
     * can name a route.
     */
    private JSONObject startInput(Destinations.Kind kind, String to) throws Exception {
        return startInput(kind, to, captureOwner.get());
    }

    private JSONObject startInput(Destinations.Kind kind, String to, String owner) throws Exception {
        if (!java.util.Objects.equals(owner, captureOwner.get())) return LinkEffect.toast("The capture belongs to another account");
        Destinations.Destination dest = Destinations.ID.matcher(to).matches() ? destinations(null).find(to) : null;
        if (dest == null || dest.kind != kind) throw new IllegalArgumentException("no destination of that name takes this kind");
        // An input that could never be sent is not captured in the first place.
        String why = InputUploader.blocked(backend);
        if (why != null) return LinkEffect.toast(NOT_SET_UP + why);
        if (!backend.configured()) return LinkEffect.toast(NOT_SET_UP + InputUploader.SITE_NOT_SET);
        Screens s = screens();
        if (s == null) return LinkEffect.toast("Not available on this device");
        try {
            s.launch(kind, dest.id, dest.label, owner);
        } catch (RuntimeException noSuchScreen) {
            // An installed app from before this screen existed.
            core.shell().note("INPUT", kind.word + " screen could not be opened: " + noSuchScreen.getClass().getSimpleName());
            return LinkEffect.toast(dest.label + ": not available in the installed app");
        }
        core.shell().note("INPUT", kind.word + " screen opened for " + dest.id);
        return LinkEffect.none();
    }

    private JSONObject captureStatus(InputQueue q, String owner) throws Exception {
        if (!owner.equals(captureOwner.get())) return Replies.err("account_unavailable");
        scan(q);
        JSONArray rows = q.captureStatus(owner, clock.getAsLong());
        JSONArray display = new JSONArray();
        Destinations configured = destinations(null);
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = new JSONObject(rows.getJSONObject(i).toString());
            String state = row.getString("state");
            row.put("destination", configured.label(row.getString("dest")));
            row.put("message", QueueNotice.captureMessage(state));
            row.put("action", "DELIVERED".equals(state) && row.has("entryDate")
                    ? "View in Health" : QueueNotice.captureAction(state));
            display.put(row);
        }
        if (!owner.equals(captureOwner.get())) return Replies.err("account_unavailable");
        return Replies.ok().put("inputs", display);
    }

    private JSONObject captureRow(InputQueue q, String owner, String id) throws Exception {
        if (!InputInbox.ID.matcher(id).matches()) return null;
        JSONArray rows = captureStatus(q, owner).optJSONArray("inputs");
        if (rows == null) return null;
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.getJSONObject(i);
            if (id.equals(row.getString("id"))) return row;
        }
        return null;
    }

    private JSONObject replaceCapture(InputQueue q, String owner, String id) throws Exception {
        JSONObject row = captureRow(q, owner, id);
        if (row == null || !"Replace capture".equals(row.optString("action"))) {
            return LinkEffect.toast("This capture is unavailable");
        }
        return startInput(Destinations.Kind.of(row.getString("kind")), row.getString("dest"), owner);
    }

    private JSONObject retryCapture(InputQueue q, String owner, String id) {
        if (!owner.equals(captureOwner.get()) || !q.retryCapture(id, owner, clock.getAsLong())) {
            return Replies.err("capture_unavailable");
        }
        wake();
        return Replies.ok();
    }

    private JSONObject openCaptureStatus(String focus, String owner) throws Exception {
        Object context = core.shell().context();
        if (context == null) return LinkEffect.toast("Capture status is unavailable on this device");
        Context c = (Context) context;
        Intent intent = new Intent().setClassName(c, STATUS_ACTIVITY).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        if (focus != null && InputInbox.ID.matcher(focus).matches()) intent.putExtra("capture-id", focus);
        if (owner != null) intent.putExtra(CaptureScope.EXTRA, owner);
        c.startActivity(intent);
        return LinkEffect.none();
    }

    private JSONObject openHealth(String path) throws Exception {
        for (LinkHandler handler : core.services().all(LinkHandler.class)) {
            if ("open".equals(handler.kind())) {
                return handler.handle("", java.util.Collections.singletonMap("path", path), true);
            }
        }
        return LinkEffect.toast("Health status is unavailable");
    }

    private JSONObject tryAgain() throws Exception {
        InputQueue q = queueOrNull();
        if (q == null) return LinkEffect.toast("Not available on this device");
        int kept = q.waitingByDest().values().stream().mapToInt(Integer::intValue).sum()
                + q.parkedByDest().values().stream().mapToInt(Integer::intValue).sum();
        if (kept == 0) return LinkEffect.toast("No inputs are waiting");
        String why = InputUploader.blocked(backend);
        if (why != null) return LinkEffect.toast(NOT_SET_UP + why);
        long now = clock.getAsLong();
        q.retryAll(now);
        wake();
        // A destination whose daily allowance is used up stays held: the backend said when.
        java.util.Map<String, Long> holds = q.holds(now);
        int heldBack = 0;
        for (java.util.Map.Entry<String, Integer> w : q.waitingByDest().entrySet()) if (holds.containsKey(w.getKey())) heldBack += w.getValue();
        if (heldBack == kept) {
            return LinkEffect.toast("The daily allowance is used up. " + QueueNotice.inputs(kept) + " will be sent after about "
                    + QueueNotice.clock(q.holdUntilMs(now)));
        }
        return LinkEffect.toast("Trying again: " + QueueNotice.inputs(kept - heldBack)
                + (heldBack > 0 ? ". " + heldBack + " more wait for a daily allowance" : ""));
    }

    /**
     * Throws away the memos that could not be sent, audio and all. Asked twice: the
     * first tap says what would go and changes nothing; a second within twenty seconds
     * deletes. Only parked memos go. One that is waiting is never discarded this way.
     */
    private synchronized JSONObject discard() throws Exception {
        InputQueue q = queueOrNull();
        if (q == null) return LinkEffect.toast("Not available on this device");
        String owner = captureOwner.get();
        Predicate<InputQueue.Entry> allowed = entry -> InputQueue.owner(entry) == null;
        int parked = q.parked(allowed);
        if (parked == 0) {
            discardArmedAtMs = 0;
            return LinkEffect.toast("No inputs to discard");
        }
        long now = clock.getAsLong();
        if (!java.util.Objects.equals(discardArmedOwner, owner) || discardArmedAtMs == 0
                || now - discardArmedAtMs > DISCARD_CONFIRM_MS || now < discardArmedAtMs) {
            discardArmedAtMs = now;
            discardArmedOwner = owner;
            return LinkEffect.toast("Tap Discard again to delete " + QueueNotice.inputs(parked) + " that could not be sent. This cannot be undone.");
        }
        discardArmedAtMs = 0;
        List<String> files = q.discardParked(allowed);
        for (String path : files) new File(path).delete();
        core.shell().note("INPUT", "discarded " + files.size() + " parked input(s) at the owner's request");
        announce(q);
        return LinkEffect.toast("Discarded " + QueueNotice.inputs(files.size()));
    }

    private Screens screens() {
        if (screens == null) {
            final Object context = core.shell().context();
            if (context == null) return null;
            final Context c = (Context) context;
            screens = new Screens() {
                @Override public void record(String dest, String label) { launch(Destinations.Kind.VOICE, dest, label, captureOwner.get()); }
                @Override public void text(String dest, String label) { launch(Destinations.Kind.TEXT, dest, label, captureOwner.get()); }
                @Override public void photo(String dest, String label) { launch(Destinations.Kind.PHOTO, dest, label, captureOwner.get()); }

                /**
                 * By name: a capture screen is installed code in this capability's shell half.
                 * None is exported, so only this app can start one. Started while the link
                 * activity is on screen, which is what lets a service context start one.
                 */
                @Override public void launch(Destinations.Kind kind, String dest, String label, String owner) {
                    String activity = kind == Destinations.Kind.TEXT ? TEXT_ACTIVITY
                            : kind == Destinations.Kind.PHOTO ? PHOTO_ACTIVITY : RECORD_ACTIVITY;
                    Intent request = new Intent().setClassName(c, activity).putExtra(EXTRA_DEST, dest)
                            .putExtra(EXTRA_LABEL, label).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    if (owner != null) request.putExtra(CaptureScope.EXTRA, owner);
                    c.startActivity(request);
                }
            };
        }
        return screens;
    }

    /** The configured destinations. A line that cannot be used is left out and reported, never thrown. */
    Destinations destinations(List<String> problems) {
        List<String> lines = new ArrayList<>();
        for (int i = 1; i <= Destinations.SLOTS; i++) lines.add((String) core.settings().get(DEST + i));
        return Destinations.usable(lines, problems);
    }

    /** Where a share from another app may go (ShareActivity): ids and labels, the default first. */
    JSONObject shareTargets() {
        try {
            JSONArray targets = new JSONArray();
            for (Destinations.Destination d : destinations(null).shareTargets()) {
                targets.put(new JSONObject().put("id", d.id).put("label", d.label));
            }
            return Replies.ok().put("targets", targets);
        } catch (org.json.JSONException impossible) {
            return Replies.err("bad_request");
        }
    }

    /** Ids, labels and kinds. No route: where the backend is reached is not for a status answer. */
    private JSONArray describeDestinations() throws org.json.JSONException {
        JSONArray out = new JSONArray();
        for (Destinations.Destination d : destinations(null).all()) {
            out.put(new JSONObject().put("id", d.id).put("label", d.label).put("kind", d.kind.word));
        }
        return out;
    }

    private List<String> problems() {
        List<String> out = new ArrayList<>();
        destinations(out);
        if (backend.user().isEmpty()) out.add("identity.user is not set: quick inputs cannot be sent");
        else if (InputUploader.blocked(backend) != null) out.add("identity.device is not fleet:<key>: quick inputs cannot be sent");
        if (!backend.configured()) out.add(InputUploader.SITE_NOT_SET);
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
            core.shell().note("INPUT", "no network callback, relying on the timer: " + e.getClass().getSimpleName());
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
