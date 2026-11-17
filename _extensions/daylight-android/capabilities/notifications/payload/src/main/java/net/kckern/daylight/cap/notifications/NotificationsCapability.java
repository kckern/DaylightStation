package net.kckern.daylight.cap.notifications;

import net.kckern.daylight.api.PayloadPort;
import net.kckern.daylight.api.PayloadState;
import net.kckern.daylight.core.Capability;
import net.kckern.daylight.core.CoreContext;
import net.kckern.daylight.core.LinkEffect;
import net.kckern.daylight.core.Requests;
import net.kckern.daylight.core.Router;
import net.kckern.daylight.core.SettingsRegistry;
import net.kckern.daylight.core.backend.Backend;
import net.kckern.daylight.core.kiosk.Origins;
import net.kckern.daylight.core.spi.LinkHandler;
import net.kckern.daylight.core.spi.LinkKeySource;
import net.kckern.daylight.core.spi.LocalNotices;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * Receives every link the app is sent and hands it to the capability that owns its
 * kind. A link arrives from the installed link activity through the "links"
 * PayloadPort, or from the control API (POST /link), and both take the same path:
 * parse, check the origin or the install key, dispatch, answer with a LinkEffect.
 *
 * It also posts the app's own local notifications for the other capabilities
 * (LocalNotices). There is no push transport here: household pushes keep arriving
 * through the Home Assistant relay. A tap on a local notice is one of this app's own
 * links and takes the path above.
 */
public final class NotificationsCapability implements Capability, LinkKeySource, LocalNotices {
    static final String ORIGINS = "links.origins";

    private final RefusalLog refusals = new RefusalLog();
    private final PayloadPort port = PayloadPort.named(PayloadPort.LINKS);
    private final PayloadPort.Handler onLink = request -> {
        String uri;
        try { uri = new JSONObject(request).optString("uri", ""); }
        catch (Exception notJson) { uri = ""; }
        return handle(uri).body.toString();
    };

    /** The Android side of local notifications, behind an interface so the rest runs in JVM tests. */
    interface NoticeSink {
        void ensureChannels();
        void post(Notice notice);
        void cancel(int androidId);
        /** "granted", "denied", or "unavailable" where there is no notification service. */
        String permission();
    }

    private CoreContext core;
    private Backend backend;
    private volatile String key;
    private volatile NoticeSink sink;

    public NotificationsCapability() { }

    NotificationsCapability(NoticeSink sink) { this.sink = sink; }

    /** A link's answer, with the HTTP status the control route gives it. */
    static final class Outcome {
        final int status;
        final JSONObject body;
        Outcome(int status, JSONObject body) { this.status = status; this.body = body; }
    }

    @Override public String name() { return "notifications"; }

    @Override public void register(CoreContext core) {
        this.core = core;
        this.backend = Backend.from(core);
        // Web origins whose links open in the app, beside the backend's own. The link
        // activity's https filter names one host; this is where that host is trusted.
        core.settings().declare(ORIGINS, SettingsRegistry.Type.STRING, "", value -> {
            for (String part : ((String) value).split(",")) {
                if (!part.trim().isEmpty() && Origins.of(part.trim()) == null) {
                    return "must be a comma-separated list of http(s) origins";
                }
            }
            return null;
        });
        core.services().provide(LinkKeySource.class, this);
        core.services().provide(LocalNotices.class, this);

        // The same path the link activity takes, for the CLI: nothing opens on the
        // device's screen from here unless the handler itself loads a page.
        core.router().route("POST", "/link", req -> {
            Outcome o = handle(Requests.body(req).optString("uri", ""));
            return Router.Response.json(o.status, o.body);
        });

        // The same calls the other capabilities make in process. The answer never holds
        // the link, which can carry the install key.
        core.router().route("POST", "/notify", req -> {
            JSONObject body = Requests.body(req);
            Notice notice = show(str(body, "id"), body.optString("channel", GENERAL), str(body, "title"), str(body, "text"), str(body, "uri"));
            return Router.Response.json(200, new JSONObject().put("ok", true).put("androidId", notice.androidId()));
        });
        core.router().route("POST", "/notify/cancel", req -> {
            String id = str(Requests.body(req), "id");
            if (id.isEmpty()) throw new IllegalArgumentException("body needs 'id'");
            cancel(id);
            return Router.Response.json(200, new JSONObject().put("ok", true));
        });
        core.router().route("GET", "/notify/status", req -> {
            NoticeSink s = sink();
            return Router.Response.json(200, new JSONObject().put("ok", true)
                    .put("permission", s == null ? "unavailable" : s.permission())
                    .put("channels", new JSONArray(java.util.Arrays.asList(Notice.CHANNELS))));
        });
    }

    private static String str(JSONObject o, String key) {
        Object v = o.opt(key);
        return v instanceof String ? (String) v : "";
    }

    /**
     * The port needs no Android context, so it is attached in a JVM test of the whole
     * payload too. Nothing here can fail on a bad setting.
     */
    @Override public void start() {
        installKey();
        port.attach(onLink);
        // A device that refuses a channel must not take the whole payload down with it.
        try {
            NoticeSink s = sink();
            if (s != null) s.ensureChannels();
        } catch (RuntimeException e) {
            core.shell().note("NOTIFY", "could not create channels: " + e.getClass().getSimpleName());
        }
    }

    /** May be called twice. Detaches only this payload's handler: a successor may already be attached. */
    @Override public void stop() {
        port.detach(onLink);
    }

    // ── LocalNotices ──────────────────────────────────────────────────────────

    /** Null with no Android context (a JVM test of the whole payload): a post then shows nothing. */
    private NoticeSink sink() {
        NoticeSink s = sink;
        if (s == null) {
            Object context = core.shell().context();
            if (context == null) return null;
            s = new AndroidNotices((android.content.Context) context);
            sink = s;
        }
        return s;
    }

    @Override public void post(String id, String channel, String title, String text, String linkUri) {
        show(id, channel, title, text, linkUri);
    }

    /**
     * A notice that cannot be described is refused (IllegalArgumentException). One that
     * Android will not show (the owner has not allowed notifications) is not an error:
     * nothing appears, and GET /notify/status says why.
     */
    private Notice show(String id, String channel, String title, String text, String linkUri) {
        Notice notice = Notice.of(id, channel, title, text, linkUri, installKey());
        NoticeSink s = sink();
        if (s != null) s.post(notice);
        return notice;
    }

    @Override public void cancel(String id) {
        NoticeSink s = sink();
        if (s != null && id != null) s.cancel(Notice.androidId(id));
    }

    @Override public String installKey() {
        String k = key;
        if (k == null) {
            synchronized (this) {
                if (key == null) key = LinkKey.loadOrCreate(new File(PayloadState.dir(core.shell().payloadDir()), "link-key"));
                k = key;
            }
        }
        return k;
    }

    Outcome handle(String uri) {
        try {
            DeepLink link;
            try {
                link = DeepLink.parse(uri, webOrigins());
            } catch (IllegalArgumentException malformed) {
                return refuse(400, "bad_link", malformed.getMessage(), "That link cannot be opened here");
            }
            if (!link.authorized(installKey())) {
                return refuse(403, "forbidden", "a " + link.kind + " link without this install's key",
                        "That link is not allowed");
            }
            LinkHandler owner = null;
            for (LinkHandler h : core.services().all(LinkHandler.class)) {
                if (link.kind.equals(h.kind())) { owner = h; break; }
            }
            if (owner == null) return new Outcome(200, LinkEffect.toast("Not available on this device"));
            try {
                JSONObject effect = owner.handle(link.arg, link.handlerQuery(), link.presentsKey(installKey()));
                return new Outcome(200, effect == null ? LinkEffect.none() : effect);
            } catch (IllegalArgumentException unknown) {
                // The handler's reason is its own fixed text about its own configuration.
                return refuse(400, "bad_link", "a " + link.kind + " link was not accepted", "That link cannot be opened here");
            } catch (Exception broke) {
                core.shell().note("LINK", "a " + link.kind + " link failed: " + broke.getClass().getSimpleName());
                return new Outcome(500, LinkEffect.refused("failed", "That did not work"));
            }
        } catch (Exception e) {
            return new Outcome(500, failedEffect());
        }
    }

    private static JSONObject failedEffect() {
        try { return LinkEffect.refused("failed", "That did not work"); }
        catch (Exception e) { return new JSONObject(); }
    }

    /** The reason is fixed text from this capability or the parser; the link itself is never logged. */
    private Outcome refuse(int status, String code, String reason, String shown) throws Exception {
        String line = refusals.line(reason, System.currentTimeMillis());
        if (line != null) {
            core.shell().note("LINK", line);
            core.log().add("link " + line);
        }
        return new Outcome(status, LinkEffect.refused(code, shown));
    }

    private Set<String> webOrigins() {
        Set<String> out = new LinkedHashSet<>(Origins.list((String) core.settings().get(ORIGINS)));
        try {
            out.add(backend.baseUrl());
        } catch (IllegalStateException notConfigured) {
            // No backend, so no site of its own to accept links for.
        }
        return out;
    }
}
