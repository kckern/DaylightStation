package net.kckern.daylight.cap.webviewhost;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;

import net.kckern.daylight.api.KioskHost;
import net.kckern.daylight.core.Capability;
import net.kckern.daylight.core.CoreContext;
import net.kckern.daylight.core.EventBus;
import net.kckern.daylight.core.Requests;
import net.kckern.daylight.core.MainThread;
import net.kckern.daylight.core.Replies;
import net.kckern.daylight.core.Router;
import net.kckern.daylight.core.SettingsRegistry;
import net.kckern.daylight.core.SettingsRegistry.Type;
import net.kckern.daylight.core.spi.KioskSurface;
import net.kckern.daylight.core.spi.LockdownControl;

import org.json.JSONObject;

/**
 * The kiosk: a fullscreen WebView in the shell's KioskActivity, the window.daylight
 * page bridge, page-load recovery, and the /kiosk routes of the control API.
 */
public final class WebViewHostCapability implements Capability {
    private CoreContext core;
    private KioskSession session;
    private volatile Context context;
    private volatile ConnectivityManager connectivity;
    private volatile boolean running;

    private final EventBus.Listener toPage = (topic, detail) -> {
        // "key" is for a capability whose accessibility key filter sees keys before the Activity does.
        if ("screen".equals(topic) || "network".equals(topic) || "key".equals(topic)) session.emit(topic, detail);
    };

    private final ConnectivityManager.NetworkCallback network = new ConnectivityManager.NetworkCallback() {
        @Override public void onAvailable(Network n) { networkChanged(true); }
        @Override public void onLost(Network n) { networkChanged(false); }
    };

    @Override public String name() { return "webview-host"; }

    @Override public void register(CoreContext core) {
        this.core = core;
        this.session = new KioskSession(core);

        core.settings().declare("webview.startUrl", Type.STRING, "");
        core.settings().declare("webview.bridgeOrigins", Type.STRING, "");
        // Origins the main frame may navigate to beyond the start URL's own. Comma-separated
        // origins or URLs. Empty (every device's default): the start origin only.
        core.settings().declare("webview.allowedOrigins", Type.STRING, "");
        core.settings().declare("webview.backButton", Type.STRING, KioskSession.DEFAULT_BACK_MODE,
                SettingsRegistry.oneOf(KeyRouter.BACK_MODES));
        core.settings().declare("webview.interceptKeys", Type.STRING, "");
        core.settings().declare("webview.loadTimeoutSec", Type.INTEGER, 20, SettingsRegistry.range(1, 600));
        core.settings().declare("webview.allowMic", Type.BOOLEAN, true);
        core.settings().declare("webview.allowCamera", Type.BOOLEAN, true);
        core.settings().declare("webview.allowMixedContent", Type.BOOLEAN, false);
        core.settings().declare("webview.debugging", Type.BOOLEAN, false);
        core.settings().declare("webview.launchOnBoot", Type.BOOLEAN, false);
        // 0 turns the retry off.
        core.settings().declare("recovery.reloadOnPageFailureSec", Type.INTEGER, 30, SettingsRegistry.range(0, 3600));
        core.settings().declare("recovery.maxRetrySec", Type.INTEGER, 300, SettingsRegistry.range(0, 86400));
        core.settings().declare("recovery.reloadOnNetworkReturn", Type.BOOLEAN, true);
        core.settings().declare("recovery.rendererUnresponsiveSec", Type.INTEGER, 30, SettingsRegistry.range(0, 3600));

        core.services().provide(KioskSurface.class, session);
        core.services().provide(net.kckern.daylight.core.spi.PageOpener.class, session);

        Router router = core.router();
        router.route("GET", "/kiosk/status", req -> Router.Response.json(200, session.status()));
        router.route("POST", "/kiosk/load", req -> {
            JSONObject body = Requests.body(req);
            if (!(body.opt("url") instanceof String)) throw new IllegalArgumentException("body needs 'url', a string");
            return load((String) body.opt("url"), wait(body));
        });
        router.route("POST", "/kiosk/load-start", req -> {
            boolean wait = wait(Requests.body(req));
            String start = ((String) core.settings().get("webview.startUrl")).trim();
            if (start.isEmpty()) throw new IllegalArgumentException(KioskSession.NOT_CONFIGURED);
            return load(start, wait);
        });
        router.route("POST", "/kiosk/reload", req -> {
            boolean wait = wait(Requests.body(req));
            return load(session.reloadUrl(), wait);
        });
        router.route("POST", "/kiosk/foreground", req -> foreground());
        router.route("POST", "/kiosk/renderer/reset", req -> {
            LoadTracker.Result r;
            try {
                r = session.resetRendererAndWait();
            } catch (java.util.concurrent.TimeoutException slow) {
                // The new renderer did not load the page in time. Same body, a status that says so.
                return Router.Response.json(504, Replies.err("timeout").put("rendererAlive", session.attached()));
            }
            return Router.Response.json(failureStatus(r), r.ok
                    ? withLoad(Replies.ok(), r).put("rendererAlive", true)
                    : withLoad(Replies.err(r.error), r).put("rendererAlive", session.attached()));
        });
        router.route("POST", "/kiosk/restart", req -> {
            // The restart is asked of the shell after this answer has left, so the shell's
            // own refusal cannot be reported here; it is in the shell log.
            session.restartPayloadSoon();
            return Router.Response.json(200, Replies.ok().put("restarting", true));
        });
        router.route("POST", "/kiosk/overlay", req ->
                Router.Response.json(200, session.overlay(OverlayRequest.parse(Requests.body(req)))));
    }

    /** Body field `wait`: absent or true waits for the main frame; false answers at once. */
    private static boolean wait(JSONObject body) {
        if (!body.has("wait")) return true;
        if (!(body.opt("wait") instanceof Boolean)) throw new IllegalArgumentException("'wait' must be true or false");
        return (Boolean) body.opt("wait");
    }

    private Router.Response load(String url, boolean wait) throws Exception {
        if (wait) {
            LoadTracker.Result r = session.loadAndWait(url);
            return Router.Response.json(200, r.ok
                    ? withLoad(Replies.ok(), r).put("loaded", true).put("loadTimeMs", r.loadTimeMs)
                    : withLoad(Replies.err(r.error), r).put("loaded", false));
        }
        boolean queued = !session.attached();
        String loadId = session.loadAccepted(url);
        // With no kiosk Activity the load is queued for the one being started (the latest
        // request wins), and the answer says so; lastLoad carries the outcome by loadId.
        return Router.Response.json(200, Replies.ok().put("accepted", true).put("url", url).put("loadId", loadId).put("queued", queued));
    }

    /**
     * The HTTP status of a load-shaped answer: 200 when it loaded, 409 when there is no
     * kiosk Activity to do it in, 504 when the page did not finish in time, 502 when the
     * page could not be loaded.
     */
    static int failureStatus(LoadTracker.Result r) {
        if (r.ok) return 200;
        if ("no_kiosk_activity".equals(r.error)) return 409;
        if ("timeout".equals(r.error)) return 504;
        return 502;
    }

    private static JSONObject withLoad(JSONObject o, LoadTracker.Result r) throws Exception {
        return o.put("url", r.url == null ? JSONObject.NULL : r.url)
                .put("loadId", r.loadId == null ? JSONObject.NULL : r.loadId);
    }

    /** ok only after the kiosk Activity is seen resumed. */
    private Router.Response foreground() throws Exception {
        LockdownControl lockdown = core.services().find(LockdownControl.class);
        boolean inFront = session.inForeground();
        if (!inFront) {
            if (lockdown != null) {
                inFront = lockdown.recall(5000);        // uses the accessibility-context start, which works from the background
            } else if (session.bringToFront()) {
                inFront = MainThread.waitFor(session::inForeground, 5000);
            }
        }
        String front = session.frontPackage(), frontActivity = session.frontActivity();
        JSONObject o = inFront ? Replies.ok() : Replies.err("not_in_foreground");
        // 409: the kiosk could not be brought to the front in the state the device is in.
        return Router.Response.json(inFront ? 200 : 409, o.put("kioskInForeground", inFront)
                .put("foreground", front == null ? JSONObject.NULL : front)
                .put("foregroundActivity", frontActivity == null ? JSONObject.NULL : frontActivity));
    }

    /**
     * Runs on the payload loader's worker thread, which has no Looper. Nothing here
     * waits on the main thread: attaching to the Activity is posted there by the host.
     */
    @Override public void start() {
        Context shellContext = (Context) core.shell().context();
        // JVM tests boot every capability with no Android context: there is no kiosk to host.
        if (shellContext == null) return;
        context = shellContext;
        session.start(shellContext);
        running = true;
        core.events().subscribe(toPage);
        ConnectivityManager cm = (ConnectivityManager) shellContext.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm != null) {
            cm.registerDefaultNetworkCallback(network);
            connectivity = cm;
        }
        // Hears the Activity that already exists (a payload swap leaves it up) and any later one.
        core.components().watch(KioskHost.COMPONENT, instance -> {
            // A null instance means the Activity was destroyed; it already detached the session.
            if (running && instance instanceof KioskHost) ((KioskHost) instance).attach(session);
        });
        if (!(core.components().get(KioskHost.COMPONENT) instanceof KioskHost)
                && (Boolean) core.settings().get("webview.launchOnBoot")) {
            session.bringToFront();
        }
    }

    /** May be called twice, and while start() is still running. Does not wait on the main thread. */
    @Override public void stop() {
        running = false;
        try { if (core != null) core.events().unsubscribe(toPage); } catch (Throwable ignored) { }
        ConnectivityManager cm = connectivity;
        connectivity = null;
        try { if (cm != null) cm.unregisterNetworkCallback(network); } catch (Throwable ignored) { }
        try { if (session != null && context != null) session.shutdown(); } catch (Throwable ignored) { }
    }

    private void networkChanged(boolean connected) {
        try { core.events().publish("network", new JSONObject().put("connected", connected)); } catch (Exception ignored) { }
        if (connected) session.networkReturned();
    }
}
