package net.kckern.daylight.cap.mediaservice;

import net.kckern.daylight.core.backend.Backend;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.List;
import java.util.Locale;

/**
 * Lookup and browse for the phone (ops:docs/superpowers/specs/2026-11-26-phone-lookup-and-browse.md):
 * the library's first level and search results grouped by kind, audio only, from the same
 * endpoints the web uses. Lookup, not discovery: nothing here proposes anything. Pure.
 */
final class Lookup {
    private Lookup() { }

    /** The search groups, in the order the phone shows them. */
    static final String[] GROUPS = { "books", "albums", "artists", "playlists", "tracks" };
    static final String[] GROUP_TITLES = { "Books", "Albums", "Artists", "Playlists", "Tracks" };

    /** A Plex library whose albums are books (audiobooks, stories, talks), by its title. */
    static boolean bookLibrary(String libraryTitle) {
        String t = libraryTitle == null ? "" : libraryTitle.toLowerCase(Locale.ROOT);
        return t.contains("book") || t.contains("stor") || t.contains("speech");
    }

    /**
     * The library's first level: every audio Plex library (a Plex library of type artist),
     * then the household's list sources (Plex's audio playlists as "Playlists", programs,
     * watchlists, custom lists). Each entry is {id: a browse media id, title, kind}.
     */
    static JSONArray libraryRoot(JSONObject plexRoot, JSONObject audioSources) throws JSONException {
        JSONArray out = new JSONArray();
        JSONArray libs = plexRoot == null ? null : plexRoot.optJSONArray("items");
        for (int i = 0; libs != null && i < libs.length(); i++) {
            JSONObject l = libs.optJSONObject(i);
            if (l == null) continue;
            JSONObject meta = l.optJSONObject("metadata");
            String type = Json.first(meta == null ? "" : Json.str(meta, "type"), Json.str(l, "type"));
            String id = Json.str(l, "id"), title = Json.str(l, "title");
            if (!"artist".equals(type) || !ContentId.valid(id) || title.isEmpty()) continue;
            out.put(new JSONObject().put("id", MediaId.container(id)).put("title", title)
                    .put("kind", bookLibrary(title) ? "books" : "library"));
        }
        JSONArray sources = audioSources == null ? null : audioSources.optJSONArray("items");
        for (int i = 0; sources != null && i < sources.length(); i++) {
            JSONObject s = sources.optJSONObject(i);
            if (s == null) continue;
            String id = Json.str(s, "id"), title = Json.str(s, "title");
            if (!ContentId.valid(id) || title.isEmpty()) continue;
            out.put(new JSONObject().put("id", MediaId.audioSource(id, 0))
                    .put("title", "plex:playlists".equals(id) ? "Playlists" : title).put("kind", "lists"));
        }
        return out;
    }

    /** Which group a search item belongs to, or null when the phone does not play it. */
    static String groupOf(JSONObject item) {
        JSONObject meta = item.optJSONObject("metadata");
        String type = meta == null ? "" : Json.str(meta, "type");
        String library = meta == null ? "" : Json.first(Json.str(meta, "librarySectionTitle"), Json.str(meta, "library"));
        if ("container".equals(Json.str(item, "itemType"))) {
            switch (type) {
                case "album": return bookLibrary(library) ? "books" : "albums";
                case "artist": return "artists";
                case "playlist": return "playlists";
                default: return null;   // shows, seasons, films: not for this player
            }
        }
        String media = Json.first(Json.str(item, "mediaType"), type).toLowerCase(Locale.ROOT);
        if (Json.str(item, "mediaUrl").isEmpty() && !"track".equals(type)) return null;
        if (!media.isEmpty() && !media.equals("audio") && !media.equals("track")) return null;
        return "tracks";
    }

    /**
     * Search results by group: {groups:[{key, title, items:[{id, contentId, title,
     * subtitle?, artUrl?, kind, browsable, playable}], more}], offline:false}. At most
     * {@code perGroup} items each; "more" says how many were left out.
     */
    static JSONObject groups(JSONObject response, Backend backend, int perGroup) throws JSONException {
        JSONArray[] buckets = new JSONArray[GROUPS.length];
        int[] more = new int[GROUPS.length];
        for (int g = 0; g < GROUPS.length; g++) buckets[g] = new JSONArray();
        JSONArray items = response == null ? null : response.optJSONArray("items");
        for (int i = 0; items != null && i < items.length(); i++) {
            JSONObject item = items.optJSONObject(i);
            if (item == null) continue;
            String id = Json.str(item, "id"), title = Json.str(item, "title");
            String group = groupOf(item);
            if (group == null || !ContentId.valid(id) || title.isEmpty()) continue;
            int g = java.util.Arrays.asList(GROUPS).indexOf(group);
            if (buckets[g].length() >= perGroup) { more[g]++; continue; }
            JSONObject meta = item.optJSONObject("metadata");
            boolean track = "tracks".equals(group);
            JSONObject o = new JSONObject().put("contentId", id).put("title", title).put("kind", group)
                    .put("id", track ? MediaId.leaf(id, null) : MediaId.container(id))
                    .put("browsable", !track).put("playable", true);
            String sub = Json.first(meta == null ? "" : Json.str(meta, "artist"),
                    meta == null ? "" : Json.str(meta, "parentTitle"), Json.str(item, "subtitle"));
            if (!sub.isEmpty()) o.put("subtitle", sub);
            String art = backend == null ? null : BrowseTree.art(backend, Json.str(item, "thumbnail"));
            if (art != null) o.put("artUrl", art);
            buckets[g].put(o);
        }
        JSONArray groups = new JSONArray();
        for (int g = 0; g < GROUPS.length; g++) {
            if (buckets[g].length() == 0) continue;
            groups.put(new JSONObject().put("key", GROUPS[g]).put("title", GROUP_TITLES[g])
                    .put("items", buckets[g]).put("more", more[g]));
        }
        return new JSONObject().put("groups", groups).put("offline", false);
    }

    /**
     * Search with no home: the collections kept on this phone whose title holds every word
     * of the query, as one group ("On this phone"), {groups, offline:true}.
     */
    static JSONObject offline(List<JSONObject> kept, String text) throws JSONException {
        String[] words = text == null ? new String[0] : text.toLowerCase(Locale.ROOT).trim().split("\\s+");
        JSONArray hits = new JSONArray();
        for (JSONObject k : kept) {
            String title = k.optString("title", "");
            String hay = title.toLowerCase(Locale.ROOT);
            boolean all = true;
            for (String w : words) if (!w.isEmpty() && !hay.contains(w)) { all = false; break; }
            String cid = k.optString("contentId");
            if (!all || !ContentId.valid(cid)) continue;
            JSONObject o = new JSONObject().put("id", MediaId.container(cid)).put("contentId", cid).put("title", title)
                    .put("kind", "kept").put("browsable", true).put("playable", true);
            if (k.has("art")) o.put("artUrl", k.optString("art"));
            hits.put(o);
        }
        JSONArray groups = new JSONArray();
        if (hits.length() > 0) groups.put(new JSONObject().put("key", "kept").put("title", "On this phone").put("items", hits).put("more", 0));
        return new JSONObject().put("groups", groups).put("offline", true);
    }
}
