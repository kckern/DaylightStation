package net.kckern.daylight.cap.onetap;

import android.content.Context;

import net.kckern.daylight.cap.onetap.ActionCatalog.Action;
import net.kckern.daylight.cap.onetap.ActionCatalog.Kind;
import net.kckern.daylight.core.Capability;
import net.kckern.daylight.core.CoreContext;
import net.kckern.daylight.core.LinkEffect;
import net.kckern.daylight.core.Replies;
import net.kckern.daylight.core.Requests;
import net.kckern.daylight.core.Router;
import net.kckern.daylight.core.SettingsRegistry;
import net.kckern.daylight.core.UnsupportedException;
import net.kckern.daylight.core.backend.Backend;
import net.kckern.daylight.core.backend.BackendHttp;
import net.kckern.daylight.core.backend.Http;
import net.kckern.daylight.core.spi.ActionList;
import net.kckern.daylight.core.spi.LinkHandler;
import net.kckern.daylight.core.spi.LinkKeySource;
import net.kckern.daylight.core.spi.ShortcutPinner;
import net.kckern.daylight.api.PayloadState;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * One-tap actions. The list is settings (actions.1 to actions.16); every surface
 * (launcher shortcuts, pinned shortcuts, tiles, and the widget through ActionList) is
 * built from it and launches the same keyed link, daylight://action/<id>#k=<key>.
 *
 * Running an action takes its id and nothing else. An API action sends an empty POST to
 * the path in its settings line; no part of a link, an intent or a request body reaches
 * the method, the path or the body.
 */
public final class OneTapActionsCapability implements Capability, ActionList {
    static final int SLOTS = 16;
    static final String WORKER = "Daylight-action";
    private static final String MEMO_FALLBACK = "actions.memoFallbackPath";
    private static final String SHORTCUTS = "actions.shortcuts";
    private static final String TILES = "actions.tiles";
    /** What "On my way" (location:share) answers, and all it does. */
    static final String LOCATION_NOT_BUILT = "Location sharing is not built yet";
    static final String REMOVED = "This action was removed from the phone's list. Its tile or shortcut now shows it is unavailable";

    private CoreContext core;
    private Backend backend;
    private Http http;
    private SurfaceSink sink;
    private volatile ExecutorService worker;
    /** How long a tap waits for an API action's answer before it is told "sent". */
    volatile long apiWaitMs = 8000;

    public OneTapActionsCapability() { }

    OneTapActionsCapability(Http http, SurfaceSink sink) {
        this.http = http;
        this.sink = sink;
    }

    @Override public String name() { return "one-tap-actions"; }

    @Override public void register(final CoreContext core) {
        this.core = core;
        this.backend = Backend.from(core);
        if (http == null) http = new BackendHttp(backend::deviceHeader);
        for (int i = 1; i <= SLOTS; i++) {
            core.settings().declare("actions." + i, SettingsRegistry.Type.STRING, "", value -> ActionCatalog.problem((String) value));
        }
        core.settings().declare(SHORTCUTS, SettingsRegistry.Type.STRING, "", value -> SurfacePlan.listProblem((String) value, SLOTS));
        core.settings().declare(TILES, SettingsRegistry.Type.STRING, "",
                value -> SurfacePlan.listProblem((String) value, SurfacePlan.TILE_SLOTS));
        // STAND-IN in a build without the quick-input capability: with nothing to capture
        // with, a memo or input action opens this page of the site in the app instead.
        core.settings().declare(MEMO_FALLBACK, SettingsRegistry.Type.STRING, "/", value -> {
            try { Backend.pagePath((String) value); return null; }
            catch (IllegalArgumentException e) { return "must be a page of the site, starting with a single '/'"; }
        });

        core.services().provide(ActionList.class, this);
        core.services().provide(ShortcutPinner.class, new ShortcutPinner() {
            @Override public boolean canPin() {
                SurfaceSink s = sink;
                try { return s != null && s.canPin(); } catch (RuntimeException e) { return false; }
            }
            @Override public JSONObject pinMedia(String contentId, String label) throws Exception {
                return OneTapActionsCapability.this.pinMedia(contentId, label);
            }
        });
        core.services().provide(LinkHandler.class, new LinkHandler() {
            @Override public String kind() { return "action"; }
            @Override public JSONObject handle(String arg, Map<String, String> query) throws Exception {
                // Only the id is read. The query is whatever the sender of the link wrote.
                if (everything().find(arg == null ? "" : arg) == null && !SurfacePlan.unrecordedMediaId(arg)) {
                    // A tile, shortcut or widget still showing an action the list no longer has
                    // (audit): said so, and every surface is published again, so it shows unavailable.
                    core.shell().note("ACTION", "a removed action was tapped");
                    try { publish(new ArrayList<String>()); } catch (Exception notNow) { /* the next start publishes */ }
                    return LinkEffect.toast(REMOVED);
                }
                return run(arg);
            }
        });

        core.router().route("GET", "/actions", req -> {
            List<String> problems = new ArrayList<>();
            JSONArray out = new JSONArray();
            ActionCatalog catalog = catalog(problems);
            // What the surface lists cannot place is a problem of the configuration too,
            // whether or not anything has been published. No link is built for this.
            SurfacePlan.usable(catalog, (String) core.settings().get(SHORTCUTS), (String) core.settings().get(TILES),
                    SLOTS, a -> "", problems);
            for (Action a : catalog.all()) {
                JSONObject o = new JSONObject().put("id", a.id).put("label", a.label).put("icon", a.icon)
                        .put("kind", a.kind.name().toLowerCase(java.util.Locale.ROOT)).put("target", a.value);
                if (memoIsStandIn(a) || a.kind == Kind.LOCATION) o.put("placeholder", true);
                out.put(o);
            }
            return Router.Response.json(200, Replies.ok().put("actions", out).put("problems", new JSONArray(problems)));
        });
        core.router().route("POST", "/actions/run", req -> {
            Object id = Requests.body(req).opt("id");
            if (!(id instanceof String)) throw new IllegalArgumentException("body needs 'id'");
            return Router.Response.json(200, run((String) id));
        });
        core.router().route("POST", "/actions/publish", req -> {
            List<String> problems = new ArrayList<>();
            SurfacePlan plan = publish(problems);
            JSONArray ids = new JSONArray();
            for (Action a : plan.shortcuts) ids.put(a.id);
            return Router.Response.json(200, Replies.ok().put("shortcuts", ids).put("tiles", new JSONArray(plan.tiles))
                    .put("problems", new JSONArray(problems)));
        });
        core.router().route("POST", "/actions/pin", req -> {
            Object id = Requests.body(req).opt("id");
            Action a = id instanceof String ? catalog(null).find((String) id) : null;
            if (a == null) throw new IllegalArgumentException("unknown action");
            requireSink().pin(a, uri(a), null);       // UnsupportedException becomes 501 with the reason
            return Router.Response.json(200, Replies.ok().put("requested", a.id));
        });
    }

    /**
     * Never throws on a setting: a line or a list entry that cannot be used is left out
     * and noted. A launcher that refuses is noted too; the actions still run from links.
     */
    @Override public void start() {
        worker = Executors.newSingleThreadExecutor(r -> {
            Thread t = new Thread(r, WORKER);
            t.setDaemon(true);
            return t;
        });
        if (sink == null) {
            Object context = core.shell().context();
            // A JVM test of the whole payload has no Android context: nothing to publish to.
            if (context == null) return;
            sink = new AndroidSurfaces((Context) context);
        }
        pinPort.attach(onPinConfirmed);
        actionPinPort.attach(onActionPin);
        launcherCapturePort.attach(onLauncherCapture);
        List<String> problems = new ArrayList<>();
        try {
            publish(problems);
        } catch (RuntimeException launcher) {
            core.shell().note("ACTION", "could not publish surfaces: " + launcher.getClass().getSimpleName());
        }
        for (String problem : problems) core.shell().note("ACTION", problem);
    }

    /** May be called twice. */
    @Override public void stop() {
        pinPort.detach(onPinConfirmed);
        actionPinPort.detach(onActionPin);
        launcherCapturePort.detach(onLauncherCapture);
        ExecutorService w = worker;
        worker = null;
        if (w != null) w.shutdownNow();
    }

    // ── ActionList ────────────────────────────────────────────────────────────

    @Override public JSONArray actions() {
        JSONArray out = new JSONArray();
        try {
            for (Action a : everything().all()) {
                out.put(new JSONObject().put("id", a.id).put("label", a.label).put("icon", a.icon).put("uri", uri(a))
                        .put("direct", a.kind == Kind.MEDIA ? a.id : ""));
            }
        } catch (Exception e) {
            // An empty list: the widget then shows its "open the app" button.
        }
        return out;
    }

    @Override public JSONObject describe(String actionId) {
        if (actionId == null) return null;
        Action a = everything().find(actionId);
        if (a == null) return null;
        try {
            return new JSONObject().put("id", a.id).put("label", a.label).put("icon", a.icon)
                    .put("kind", a.kind.name().toLowerCase(java.util.Locale.ROOT)).put("target", a.value);
        } catch (Exception e) {
            return null;
        }
    }

    @Override public String mediaContentId(String actionId) {
        if (actionId == null) return null;
        Action a = everything().find(actionId);
        return a != null && a.kind == Kind.MEDIA ? a.value : null;
    }

    // ── pinned media actions ──────────────────────────────────────────────────

    private static final String PIN_FILE = "pinned-media.json";
    /** The PayloadPort the launcher's confirmation reaches (the shell half's PinResultReceiver spells it the same). */
    static final String PIN_PORT = "pins";
    /** How long a pin request's token is good for. */
    static final long PIN_CONFIRM_MS = 10 * 60_000L;
    /** Accepted pin requests a minute, in this process, whatever document asks. */
    static final int PINS_PER_MINUTE = 3;
    /** Pin requests whose dialog is open (asked, not confirmed, not expired) at most at once. */
    static final int MAX_OPEN_PINS = 3;
    static final String LIMIT_REACHED = "limit_reached";
    static final String RATE_LIMITED = "rate_limited";
    /** What a tap on a pinned media shortcut the app never recorded answers. */
    static final String UNRECORDED_PIN = "This shortcut was not saved. Remove it and pin it again from the Media page";
    private final Object pinLock = new Object();
    private PinnedMedia pinned;
    private final java.util.LinkedHashMap<String, PendingPin> pendingPins = new java.util.LinkedHashMap<>();
    private final java.util.ArrayDeque<Long> acceptedAt = new java.util.ArrayDeque<>();
    volatile java.util.function.LongSupplier clock = System::currentTimeMillis;
    private final net.kckern.daylight.api.PayloadPort launcherCapturePort = net.kckern.daylight.api.PayloadPort.named("launcher-capture");
    private final net.kckern.daylight.api.PayloadPort.Handler onLauncherCapture = id -> {
        Action action = catalog(null).find(id);
        if (action != null && (action.kind == Kind.INPUT || ("meal-barcode".equals(id)
                && action.kind == Kind.OPEN && "/health?capture=barcode".equals(action.value)))) {
            return run(id).toString();
        }
        return LinkEffect.toast("This capture shortcut is unavailable. Add it again from your launcher.").toString();
    };
    private final net.kckern.daylight.api.PayloadPort actionPinPort = net.kckern.daylight.api.PayloadPort.named("phone-pin-action");
    private final net.kckern.daylight.api.PayloadPort.Handler onActionPin = id -> {
        if (id.isEmpty()) {
            JSONArray items = new JSONArray();
            for (Action configured : catalog(null).all()) {
                items.put(new JSONObject().put("id", configured.id).put("label", configured.label)
                        .put("icon", configured.icon).put("kind", configured.kind.name()));
            }
            return new JSONObject().put("items", items).toString();
        }
        String actionId = id;
        String requestId = null;
        if (id.startsWith("{")) {
            JSONObject request = new JSONObject(id);
            actionId = request.getString("id");
            requestId = request.getString("requestId");
            if (!"pin".equals(request.getString("op"))
                    || !java.util.UUID.fromString(requestId).toString().equals(requestId)) {
                throw new IllegalArgumentException("Invalid pin request");
            }
        }
        Action action = catalog(null).find(actionId);
        if (action == null) throw new IllegalArgumentException("Unknown action");
        if (requestId == null) requireSink().pin(action, uri(action), null);
        else requireSink().pinFromSetup(action, uri(action), requestId);
        return "{}";
    };
    private final net.kckern.daylight.api.PayloadPort pinPort = net.kckern.daylight.api.PayloadPort.named(PIN_PORT);
    private final net.kckern.daylight.api.PayloadPort.Handler onPinConfirmed = request -> {
        JSONObject r = new JSONObject(request);
        if ("confirmed".equals(r.optString("op"))) confirmPin(r.optString("token", ""));
        return "{}";
    };

    /** The configured actions and, after them, the pinned media actions. */
    private ActionCatalog everything() {
        return catalog(null).withPinned(pinned());
    }

    private File pinFile() { return new File(PayloadState.dir(core.shell().payloadDir()), PIN_FILE); }

    private PinnedMedia pinned() {
        synchronized (pinLock) {
            if (pinned == null) {
                String json = null;
                try {
                    File f = pinFile();
                    if (f.isFile()) json = new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8);
                } catch (Exception unreadable) {
                    core.shell().note("ACTION", "could not read the pinned media actions: " + unreadable.getClass().getSimpleName());
                }
                pinned = PinnedMedia.fromJson(json);
            }
            return pinned;
        }
    }

    /**
     * Asks the launcher to pin a shortcut that plays this content. Android's dialog is
     * the owner's decision, and requestPinShortcut answering true means only that the
     * dialog was shown. So nothing is recorded here: the request carries a single-use
     * token, the launcher sends the app's own non-exported receiver an immutable
     * PendingIntent with it once the shortcut is pinned, and confirmPin records the
     * entry then. A dismissed dialog records nothing.
     *
     * Refused: with MAX pins kept, a new one (limit_reached; no pin is pushed out for
     * it); more than PINS_PER_MINUTE accepted requests in a minute in this process,
     * whatever page or document asks (rate_limited). The shortcut launches the action by
     * its id, keyed like every action link; the content id is never in a link. The
     * answer is {accepted, reason?} and nothing else; accepted means the dialog was
     * asked for.
     */
    private JSONObject pinMedia(String contentId, String label) throws Exception {
        SurfaceSink s = sink;
        if (s == null) return refusal("not_available");
        if (!s.canPin()) return refusal("launcher_cannot_pin");
        Action a = new Action(PinnedMedia.idFor(contentId), label, "play", Kind.MEDIA, contentId);
        Action configured = catalog(null).find(a.id);
        if (configured != null) return refusal("failed");
        String token;
        synchronized (pinLock) {
            pruneUnpinned(s);
            PinnedMedia p = pinned();
            long now = clock.getAsLong();
            // Each open dialog holds a slot, so its confirmation is never refused for a full list.
            for (java.util.Iterator<PendingPin> it = pendingPins.values().iterator(); it.hasNext(); ) {
                if (now - it.next().atMs > PIN_CONFIRM_MS) it.remove();
            }
            if (p.find(a.id) == null && p.all().size() + reservedSlots(p, a.id) >= PinnedMedia.MAX) return refusal(LIMIT_REACHED);
            while (!acceptedAt.isEmpty() && now - acceptedAt.peekFirst() >= 60_000) acceptedAt.pollFirst();
            if (acceptedAt.size() >= PINS_PER_MINUTE) return refusal(RATE_LIMITED);
            // A dismissed dialog sends nothing back and holds its slot until it expires,
            // so at most MAX_OPEN_PINS dialogs are open at once: a page asking while nobody
            // answers can hold no more slots than that.
            if (pendingPins.size() >= MAX_OPEN_PINS) return refusal(RATE_LIMITED);
            token = newToken();
            pendingPins.put(token, new PendingPin(contentId, label, now));
        }
        try {
            s.pin(a, uri(a), token);
        } catch (RuntimeException launcher) {
            synchronized (pinLock) { pendingPins.remove(token); }
            return refusal("launcher_refused");
        }
        synchronized (pinLock) { acceptedAt.addLast(clock.getAsLong()); }
        core.shell().note("ACTION", "asked the launcher to pin " + a.id);
        return new JSONObject().put("accepted", true);
    }

    /**
     * The launcher confirmed a pin: its token, from the non-exported receiver over the
     * PIN_PORT port. A token is good once, for its own request, for PIN_CONFIRM_MS.
     */
    private void confirmPin(String token) {
        String id;
        synchronized (pinLock) {
            PendingPin req = token == null ? null : pendingPins.remove(token);
            if (req == null || clock.getAsLong() - req.atMs > PIN_CONFIRM_MS) {
                core.shell().note("ACTION", "a pin confirmation matched no request");
                return;
            }
            PinnedMedia p = pinned();
            id = PinnedMedia.idFor(req.contentId);
            if (!p.add(req.contentId, req.label, clock.getAsLong())) {
                core.shell().note("ACTION", "pinned " + id + " but the list is full; not recorded");
                return;
            }
            savePinned(p);
            core.shell().note("ACTION", "pinned " + id);
        }
        // The widgets redraw: the chooser lists the new action.
        try {
            publish(new ArrayList<String>());
        } catch (RuntimeException launcher) {
            core.shell().note("ACTION", "could not publish after a pin: " + launcher.getClass().getSimpleName());
        }
    }

    /** Open requests for content not yet in the list, other than this action: the slots they hold. */
    private int reservedSlots(PinnedMedia p, String exceptId) {
        java.util.Set<String> ids = new java.util.HashSet<>();
        for (PendingPin r : pendingPins.values()) {
            String id = PinnedMedia.idFor(r.contentId);
            if (!id.equals(exceptId) && p.find(id) == null) ids.add(id);
        }
        return ids.size();
    }

    /** Drops the entries whose pinned shortcut the launcher no longer holds, so its slot is free. */
    private void pruneUnpinned(SurfaceSink s) {
        synchronized (pinLock) {
            java.util.Set<String> held = new java.util.HashSet<>();
            try {
                if (!s.canPin()) return;
                for (String pinId : s.pinnedIds()) {
                    if (pinId.startsWith(SurfacePlan.PIN_PREFIX)) held.add(pinId.substring(SurfacePlan.PIN_PREFIX.length()));
                }
            } catch (RuntimeException launcher) {
                // The launcher did not say: keep everything.
                return;
            }
            PinnedMedia p = pinned();
            List<PinnedMedia.Entry> dropped = p.retainOnly(held);
            if (dropped.isEmpty()) return;
            savePinned(p);
            core.shell().note("ACTION", dropped.size() + " pinned media action(s) dropped: their shortcut was removed");
        }
    }

    private void savePinned(PinnedMedia p) {
        try {
            File f = pinFile();
            File dir = f.getParentFile();
            if (dir != null && !dir.isDirectory() && !dir.mkdirs()) throw new IOException("no state directory");
            File part = new File(f.getPath() + ".part");
            Files.write(part.toPath(), p.toJson().getBytes(StandardCharsets.UTF_8));
            if (!part.renameTo(f)) throw new IOException("rename failed");
        } catch (IOException disk) {
            core.shell().note("ACTION", "could not save the pinned media actions: " + disk.getClass().getSimpleName());
        }
    }

    private static String newToken() {
        byte[] b = new byte[16];
        new java.security.SecureRandom().nextBytes(b);
        StringBuilder hex = new StringBuilder();
        for (byte x : b) hex.append(String.format("%02x", x));
        return hex.toString();
    }

    private static final class PendingPin {
        final String contentId;
        final String label;
        final long atMs;

        PendingPin(String contentId, String label, long atMs) {
            this.contentId = contentId;
            this.label = label;
            this.atMs = atMs;
        }
    }

    private static JSONObject refusal(String reason) throws Exception {
        return new JSONObject().put("accepted", false).put("reason", reason);
    }

    // ── the list and its links ────────────────────────────────────────────────

    private ActionCatalog catalog(List<String> problems) {
        List<String> lines = new ArrayList<>();
        for (int i = 1; i <= SLOTS; i++) lines.add((String) core.settings().get("actions." + i));
        return ActionCatalog.usable(lines, problems == null ? new ArrayList<String>() : problems);
    }

    /** The link every surface launches. Keyed, because running an action changes something. */
    private String uri(Action a) {
        LinkKeySource keys = core.services().find(LinkKeySource.class);
        String link = "daylight://action/" + a.id;
        return keys == null ? link : keys.keyed(link);
    }

    /** A memo or input action in a build that has no quick-input capability to perform it. */
    private boolean memoIsStandIn(Action a) {
        return (a.kind == Kind.MEMO || a.kind == Kind.INPUT) && handlerFor(a.linkKind()) == null;
    }

    private LinkHandler handlerFor(String kind) {
        for (LinkHandler h : core.services().all(LinkHandler.class)) if (kind.equals(h.kind())) return h;
        return null;
    }

    // ── running ───────────────────────────────────────────────────────────────

    /** ActionList: the one path every surface's run takes (a keyed link, POST /actions/run, the car screen). */
    @Override public JSONObject run(String id) throws Exception {
        final Action a = everything().find(id == null ? "" : id);
        if (a == null && SurfacePlan.unrecordedMediaId(id)) {
            // A pinned media shortcut the owner added but the app did not record (the app
            // restarted while the dialog was open, or the confirmation came too late). Its
            // content is not known here: only a hash of it is in the id.
            core.shell().note("ACTION", id + " is a pinned shortcut that was not saved");
            return LinkEffect.toast(UNRECORDED_PIN);
        }
        if (a == null) throw new IllegalArgumentException("unknown action");
        if (a.kind == Kind.API) {
            String outcome = callApi(a);
            core.shell().note("ACTION", a.id + " " + outcome);
            return LinkEffect.toast(a.label + ": " + outcome);
        }
        if (a.kind == Kind.LOCATION) {
            // PLACEHOLDER: location sharing is not built. No permission is declared for it,
            // nothing is sent and nothing is kept; the tap only says so.
            core.shell().note("ACTION", a.id + " is a placeholder");
            return LinkEffect.toast(LOCATION_NOT_BUILT);
        }
        if (memoIsStandIn(a)) {
            // STAND-IN: capturing comes with the quick-input capability. Without it the
            // action opens the app at actions.memoFallbackPath.
            LinkHandler open = handlerFor("open");
            if (open == null) return LinkEffect.toast(a.label + ": not available on this device");
            core.shell().note("ACTION", a.id + " opened the app (no quick-input in this build)");
            return open.handle("", Collections.singletonMap("path", (String) core.settings().get(MEMO_FALLBACK)));
        }
        LinkHandler handler = handlerFor(a.linkKind());
        if (handler == null) return LinkEffect.toast(a.label + ": not available on this device");
        core.shell().note("ACTION", a.id + " run");
        return handler.handle(a.linkArg(), a.linkQuery());
    }

    /**
     * An empty POST to the action's configured path. Not queued: sent now or not at all,
     * because running it minutes later, when the VPN returns, could do something nobody
     * expects any more. The tap is answered after apiWaitMs even when the backend has
     * not answered; the request is then left to finish and its outcome is logged.
     */
    private String callApi(final Action a) {
        final String url;
        try {
            url = backend.url(a.value);
        } catch (IllegalStateException notConfigured) {
            return "the household site is not set";
        }
        ExecutorService w = worker;
        if (w == null) return post(url);
        try {
            Future<String> pending = w.submit(() -> {
                String outcome = post(url);
                return outcome;
            });
            try {
                String outcome = pending.get(apiWaitMs, TimeUnit.MILLISECONDS);
                if (!"done".equals(outcome)) notifyOutcome(a, outcome);
                return outcome;
            } catch (TimeoutException slow) {
                // The answer still counts (audit): it goes to a notification when it comes.
                Thread late = new Thread(() -> {
                    String outcome;
                    try { outcome = pending.get(LATE_WAIT_MS, TimeUnit.MILLISECONDS); }
                    catch (TimeoutException never) { outcome = "no answer from home"; }
                    catch (Exception stopped) { return; }
                    core.shell().note("ACTION", a.id + " answered late: " + outcome);
                    notifyOutcome(a, outcome);
                }, "Daylight-action-late");
                late.setDaemon(true);
                late.start();
                return "sent, no answer yet";
            }
        } catch (Exception stoppedOrInterrupted) {
            return "not sent";
        }
    }

    /** How long a slow API action's answer is waited for after the tap was answered. */
    static final long LATE_WAIT_MS = 60_000;

    /**
     * An API action's outcome as a notification (one per action, replaced by the next), so it
     * outlives the toast: "Lights off: done", or "Lights off: no connection" with Retry, which
     * runs it again through its keyed link. Only the label and the outcome, never more.
     */
    void notifyOutcome(Action a, String outcome) {
        net.kckern.daylight.core.spi.LocalNotices notices = core.services().find(net.kckern.daylight.core.spi.LocalNotices.class);
        if (notices == null) return;
        String noticeId = noticeId(a.id);
        try {
            if ("done".equals(outcome)) {
                notices.post(noticeId, net.kckern.daylight.core.spi.LocalNotices.GENERAL, a.label, a.label + ": done", "");
            } else {
                notices.post(noticeId, net.kckern.daylight.core.spi.LocalNotices.GENERAL, a.label, a.label + ": " + outcome,
                        "", "Retry", "daylight://action/" + a.id);
            }
        } catch (RuntimeException notShown) {
            core.shell().note("ACTION", "could not post the outcome of " + a.id);
        }
    }

    /** A notice id for an action: [a-z0-9-]{1,40}. */
    static String noticeId(String actionId) {
        String clean = (actionId == null ? "" : actionId).toLowerCase(java.util.Locale.ROOT).replaceAll("[^a-z0-9-]", "-");
        String id = "action-" + clean;
        return id.length() > 40 ? id.substring(0, 40) : id;
    }

    private String post(String url) {
        try {
            Http.Reply r = http.postJson(url, "{}");
            return r.ok() ? "done" : "failed (" + r.status + ")";
        } catch (IOException linkDown) {
            return "no connection";
        }
    }

    // ── surfaces ──────────────────────────────────────────────────────────────

    private SurfaceSink requireSink() {
        SurfaceSink s = sink;
        if (s == null) throw new UnsupportedException("the surfaces need a running app");
        return s;
    }

    private SurfacePlan publish(List<String> problems) {
        SurfaceSink s = requireSink();
        SurfacePlan plan = SurfacePlan.usable(catalog(problems), (String) core.settings().get(SHORTCUTS),
                (String) core.settings().get(TILES), s.maxShortcuts(), this::uri, problems);
        s.publish(plan.shortcuts, this::uri, plan.tileCache);
        // The launcher keeps a pinned shortcut's intent, key and all. Each is rewritten
        // under the key now in force, so none outlives the run it was written in.
        pruneUnpinned(s);
        try {
            s.refreshPinned(SurfacePlan.pins(everything(), s.pinnedIds()), this::uri);
        } catch (RuntimeException launcher) {
            core.shell().note("ACTION", "could not refresh the pinned shortcuts: " + launcher.getClass().getSimpleName());
        }
        // The widget (another capability) redraws from the same list.
        core.events().publish(ActionList.PUBLISHED, new JSONObject());
        return plan;
    }
}
