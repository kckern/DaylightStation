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

import org.json.JSONObject;

import java.io.File;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * Receives every link the app is sent and hands it to the capability that owns its
 * kind. A link arrives from the installed link activity through the "links"
 * PayloadPort, or from the control API (POST /link), and both take the same path:
 * parse, check the origin or the install key, dispatch, answer with a LinkEffect.
 */
public final class NotificationsCapability implements Capability, LinkKeySource {
    static final String ORIGINS = "links.origins";

    private final RefusalLog refusals = new RefusalLog();
    private final PayloadPort port = PayloadPort.named(PayloadPort.LINKS);
    private final PayloadPort.Handler onLink = request -> {
        String uri;
        try { uri = new JSONObject(request).optString("uri", ""); }
        catch (Exception notJson) { uri = ""; }
        return handle(uri).body.toString();
    };

    private CoreContext core;
    private Backend backend;
    private volatile String key;

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
                    return "'" + ORIGINS + "' must be a comma-separated list of http(s) origins";
                }
            }
            return null;
        });
        core.services().provide(LinkKeySource.class, this);

        // The same path the link activity takes, for the CLI: nothing opens on the
        // device's screen from here unless the handler itself loads a page.
        core.router().route("POST", "/link", req -> {
            Outcome o = handle(Requests.body(req).optString("uri", ""));
            return Router.Response.json(o.status, o.body);
        });
    }

    /**
     * The port needs no Android context, so it is attached in a JVM test of the whole
     * payload too. Nothing here can fail on a bad setting.
     */
    @Override public void start() {
        installKey();
        port.attach(onLink);
    }

    /** May be called twice. Detaches only this payload's handler: a successor may already be attached. */
    @Override public void stop() {
        port.detach(onLink);
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
                JSONObject effect = owner.handle(link.arg, link.handlerQuery());
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
