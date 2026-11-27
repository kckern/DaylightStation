package net.kckern.daylight.cap.mediaservice.shell;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * The payload's answer to a browse request, as plain entries. Pure. Two things are
 * held here whatever the payload sends, because the payload is replaceable code and
 * what this service hands on goes to a car and to other apps: an image is an https
 * URL or it is left out, and a level has a hard upper size.
 */
final class BrowseAnswer {
    /** The most entries one level is given, whatever the payload answers. */
    static final int MAX_ENTRIES = 250;
    /** The id of the one entry shown while no payload is loaded. It has no children. */
    static final String STARTING_ID = "starting";

    /** The payload refused, or what came back is not an answer. */
    static final class Failed extends Exception {
        Failed(String why) { super(why); }
    }

    static final class Entry {
        final String id;
        final String title;
        final String subtitle;
        /** An https URL, or null. */
        final String artUrl;
        final boolean browsable;
        final boolean playable;

        Entry(String id, String title, String subtitle, String artUrl, boolean browsable, boolean playable) {
            this.id = id;
            this.title = title;
            this.subtitle = subtitle;
            this.artUrl = artUrl;
            this.browsable = browsable;
            this.playable = playable;
        }
    }

    private BrowseAnswer() { }

    static JSONObject accepted(String json) throws Failed {
        JSONObject o;
        try {
            o = new JSONObject(json);
        } catch (Exception notAnAnswer) {
            throw new Failed("not an answer");
        }
        if (!o.optBoolean("ok", false)) throw new Failed(o.optString("error", "refused"));
        return o;
    }

    static List<Entry> parse(String json) throws Failed {
        JSONArray items = accepted(json).optJSONArray("items");
        List<Entry> out = new ArrayList<>();
        for (int i = 0; items != null && i < items.length() && out.size() < MAX_ENTRIES; i++) {
            JSONObject n = items.optJSONObject(i);
            if (n == null) continue;
            String id = n.optString("id", "");
            String title = n.optString("title", "");
            if (id.isEmpty() || title.isEmpty()) continue;
            out.add(new Entry(id, title, n.optString("subtitle", ""), https(n.optString("artUrl", "")),
                    n.optBoolean("browsable", false), n.optBoolean("playable", false)));
        }
        return out;
    }

    /** What the root holds while no payload is loaded: one tab that says so. */
    static List<Entry> starting() {
        return Collections.singletonList(new Entry(STARTING_ID, "Starting up…", "", null, true, false));
    }

    static String https(String url) {
        return url != null && url.startsWith("https://") && url.length() > "https://".length() ? url : null;
    }
}
