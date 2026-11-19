package net.kckern.daylight.cap.bookmarks;

import net.kckern.daylight.core.Capability;
import net.kckern.daylight.core.CoreContext;
import net.kckern.daylight.core.LinkEffect;
import net.kckern.daylight.core.Replies;
import net.kckern.daylight.core.Router;
import net.kckern.daylight.core.SettingsRegistry;
import net.kckern.daylight.core.backend.Backend;
import net.kckern.daylight.core.spi.LinkHandler;
import net.kckern.daylight.core.spi.PageOpener;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Bookmarks, and the two link kinds that open a page: "open" (a path of the site) and
 * "bookmark" (a configured one by id). The page itself belongs to webview-host; this
 * capability works out the URL, checks it, and asks for it through PageOpener.
 *
 * A URL is only ever the backend's origin followed by a path that Backend.pagePath
 * accepted: a link can pick a page of the site and nothing else.
 */
public final class BookmarksCapability implements Capability {
    static final int SLOTS = 8;

    private CoreContext core;
    private Backend backend;

    @Override public String name() { return "bookmarks"; }

    @Override public void register(final CoreContext core) {
        this.core = core;
        this.backend = Backend.from(core);
        // The rule refuses a malformed line when it is set and when it arrives as a
        // device default (which fails that device's build), so none is ever stored.
        for (int i = 1; i <= SLOTS; i++) {
            core.settings().declare("bookmarks." + i, SettingsRegistry.Type.STRING, "", value -> Bookmarks.problem((String) value));
        }

        core.services().provide(LinkHandler.class, new LinkHandler() {
            @Override public String kind() { return "open"; }
            @Override public JSONObject handle(String arg, Map<String, String> query) throws Exception {
                return handle(arg, query, true);
            }
            @Override public JSONObject handle(String arg, Map<String, String> query, boolean keyed) throws Exception {
                String path = query.get("path");
                if (path == null) throw new IllegalArgumentException("an open link needs a path");
                // Without the install key the link can come from any app or web page: it
                // may pick one of the configured bookmarks, exactly as configured, with no
                // query or fragment of its own. Any other page needs the key.
                if (!keyed && !current(null).hasPath(path)) throw new IllegalArgumentException("not a bookmarked page");
                return open(path, keyed);
            }
        });
        core.services().provide(LinkHandler.class, new LinkHandler() {
            @Override public String kind() { return "bookmark"; }
            @Override public JSONObject handle(String arg, Map<String, String> query) throws Exception {
                return handle(arg, query, true);
            }
            @Override public JSONObject handle(String arg, Map<String, String> query, boolean keyed) throws Exception {
                Bookmarks.Bookmark b = current(null).find(arg);
                if (b == null) throw new IllegalArgumentException("unknown bookmark");
                return open(b.path, keyed);
            }
        });

        core.router().route("GET", "/bookmarks", req -> {
            List<String> problems = new ArrayList<>();
            JSONArray out = new JSONArray();
            for (Bookmarks.Bookmark b : current(problems).items) {
                out.put(new JSONObject().put("id", b.id).put("label", b.label).put("icon", b.icon)
                        .put("path", b.path).put("uri", "daylight://bookmark/" + b.id));
            }
            return Router.Response.json(200, Replies.ok().put("bookmarks", out).put("problems", new JSONArray(problems)));
        });
    }

    /** Says once what is wrong with the list. Never throws: a bad line is left out, the rest work. */
    @Override public void start() {
        List<String> problems = new ArrayList<>();
        current(problems);
        for (String problem : problems) core.shell().note("BOOKMARK", problem);
    }

    @Override public void stop() { }

    private Bookmarks current(List<String> problems) {
        List<String> lines = new ArrayList<>();
        for (int i = 1; i <= SLOTS; i++) lines.add((String) core.settings().get("bookmarks." + i));
        return Bookmarks.usable(lines, problems == null ? new ArrayList<String>() : problems);
    }

    /** @param trusted false for a link without the install key: the page host is told, and gives that page no capture */
    private JSONObject open(String path, boolean trusted) throws Exception {
        String checked = Backend.pagePath(path);         // IllegalArgumentException for anything but a page of the site
        PageOpener opener = core.services().find(PageOpener.class);
        if (opener == null) return LinkEffect.toast("Not available on this device");
        String url;
        try {
            url = backend.baseUrl() + checked;
        } catch (IllegalStateException notConfigured) {
            return LinkEffect.refused("not_configured", "The address of the household site is not set");
        }
        if (trusted) opener.open(url); else opener.openFromOutside(url);
        return LinkEffect.front();
    }
}
