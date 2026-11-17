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

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
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
 * One-tap actions. The list is settings (actions.1 to actions.12); every surface
 * (launcher shortcuts, pinned shortcuts, tiles, and the widget through ActionList) is
 * built from it and launches the same keyed link, daylight://action/<id>#k=<key>.
 *
 * Running an action takes its id and nothing else. An API action sends an empty POST to
 * the path in its settings line; no part of a link, an intent or a request body reaches
 * the method, the path or the body.
 */
public final class OneTapActionsCapability implements Capability, ActionList {
    static final int SLOTS = 12;
    static final String WORKER = "Daylight-action";
    private static final String MEMO_FALLBACK = "actions.memoFallbackPath";
    private static final String SHORTCUTS = "actions.shortcuts";
    private static final String TILES = "actions.tiles";

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
        core.services().provide(LinkHandler.class, new LinkHandler() {
            @Override public String kind() { return "action"; }
            @Override public JSONObject handle(String arg, Map<String, String> query) throws Exception {
                // Only the id is read. The query is whatever the sender of the link wrote.
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
                if (memoIsStandIn(a)) o.put("placeholder", true);
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
            requireSink().pin(a, uri(a));       // UnsupportedException becomes 501 with the reason
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
        ExecutorService w = worker;
        worker = null;
        if (w != null) w.shutdownNow();
    }

    // ── ActionList ────────────────────────────────────────────────────────────

    @Override public JSONArray actions() {
        JSONArray out = new JSONArray();
        try {
            for (Action a : catalog(null).all()) {
                out.put(new JSONObject().put("id", a.id).put("label", a.label).put("icon", a.icon).put("uri", uri(a)));
            }
        } catch (Exception e) {
            // An empty list: the widget then shows its "open the app" button.
        }
        return out;
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

    private JSONObject run(String id) throws Exception {
        final Action a = catalog(null).find(id == null ? "" : id);
        if (a == null) throw new IllegalArgumentException("unknown action");
        if (a.kind == Kind.API) {
            String outcome = callApi(a);
            core.shell().note("ACTION", a.id + " " + outcome);
            return LinkEffect.toast(a.label + ": " + outcome);
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
                return pending.get(apiWaitMs, TimeUnit.MILLISECONDS);
            } catch (TimeoutException slow) {
                return "sent, no answer yet";
            }
        } catch (Exception stoppedOrInterrupted) {
            return "not sent";
        }
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
        try {
            s.refreshPinned(SurfacePlan.pins(catalog(null), s.pinnedIds()), this::uri);
        } catch (RuntimeException launcher) {
            core.shell().note("ACTION", "could not refresh the pinned shortcuts: " + launcher.getClass().getSimpleName());
        }
        // The widget (another capability) redraws from the same list.
        core.events().publish(ActionList.PUBLISHED, new JSONObject());
        return plan;
    }
}
