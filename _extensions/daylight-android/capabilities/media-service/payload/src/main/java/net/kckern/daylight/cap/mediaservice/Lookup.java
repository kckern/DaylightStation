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
                    .put("kind", bookLibrary(title) ? "library-books" : "library"));
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
     * An author in a book library found by search: their books, for the Books group (Plex's
     * search finds "Boethius" the author, not the book whose title does not hold the name).
     */
    static JSONArray booksOf(JSONObject children, String author, Backend backend, int max) throws JSONException {
        JSONArray out = new JSONArray();
        JSONArray items = children == null ? null : children.optJSONArray("items");
        for (int i = 0; items != null && i < items.length() && out.length() < max; i++) {
            JSONObject c = items.optJSONObject(i);
            if (c == null) continue;
            String id = Json.str(c, "id"), title = Json.str(c, "title");
            if (!ContentId.valid(id) || title.isEmpty() || !"container".equals(Json.str(c, "itemType"))) continue;
            JSONObject o = new JSONObject().put("id", MediaId.container(id)).put("contentId", id).put("title", title)
                    .put("kind", "books").put("browsable", true).put("playable", true);
            if (author != null && !author.isEmpty()) o.put("subtitle", author);
            String art = backend == null ? null : BrowseTree.art(backend, Json.str(c, "thumbnail"));
            if (art != null) o.put("artUrl", art);
            out.put(o);
        }
        return out;
    }

    /** Authors (artists in a book library) among search results: their content ids and names. */
    static java.util.List<String[]> authors(JSONObject response, int max) {
        java.util.List<String[]> out = new java.util.ArrayList<>();
        JSONArray items = response == null ? null : response.optJSONArray("items");
        for (int i = 0; items != null && i < items.length() && out.size() < max; i++) {
            JSONObject item = items.optJSONObject(i);
            if (item == null || !"container".equals(Json.str(item, "itemType"))) continue;
            JSONObject meta = item.optJSONObject("metadata");
            if (meta == null || !"artist".equals(Json.str(meta, "type"))) continue;
            String lib = Json.first(Json.str(meta, "librarySectionTitle"), Json.str(meta, "library"));
            if (!bookLibrary(lib) || !ContentId.valid(Json.str(item, "id"))) continue;
            out.add(new String[] { Json.str(item, "id"), Json.str(item, "title") });
        }
        return out;
    }

    /** Puts {@code books} first in the Books group of {@code body}, making the group when there is none. */
    static void prependBooks(JSONObject body, JSONArray books) throws JSONException {
        if (books.length() == 0) return;
        JSONArray groups = body.getJSONArray("groups");
        JSONObject booksGroup = null;
        for (int g = 0; g < groups.length(); g++) if ("books".equals(groups.getJSONObject(g).optString("key"))) booksGroup = groups.getJSONObject(g);
        JSONArray merged = new JSONArray();
        java.util.Set<String> seen = new java.util.HashSet<>();
        for (int i = 0; i < books.length(); i++) if (seen.add(books.getJSONObject(i).optString("id"))) merged.put(books.getJSONObject(i));
        if (booksGroup != null) {
            JSONArray old = booksGroup.getJSONArray("items");
            for (int i = 0; i < old.length(); i++) if (seen.add(old.getJSONObject(i).optString("id"))) merged.put(old.getJSONObject(i));
            booksGroup.put("items", merged);
            return;
        }
        JSONArray reordered = new JSONArray().put(new JSONObject().put("key", "books").put("title", "Books").put("items", merged).put("more", 0));
        for (int g = 0; g < groups.length(); g++) reordered.put(groups.get(g));
        body.put("groups", reordered);
    }

    /**
     * What a track belongs to, from its info: {album:{id, title, kind}, artist:{id, title, kind}}
     * as browse media ids, a book library's being a book and an author.
     */
    static JSONObject parents(JSONObject info) throws JSONException {
        JSONObject out = new JSONObject();
        JSONObject meta = info == null ? null : info.optJSONObject("metadata");
        if (meta == null) return out;
        String source = ContentId.source(Json.first(Json.str(info, "contentId"), Json.str(info, "id"), "plex:0"));
        boolean books = bookLibrary(Json.str(meta, "librarySectionTitle"));
        String album = Json.str(meta, "albumId"), artist = Json.str(meta, "artistId");
        if (!album.isEmpty() && ContentId.valid(source + ":" + album)) {
            out.put("album", new JSONObject().put("id", MediaId.container(source + ":" + album))
                    .put("title", Json.first(Json.str(meta, "album"), Json.str(meta, "parentTitle"))).put("kind", books ? "book" : "album"));
        }
        if (!artist.isEmpty() && ContentId.valid(source + ":" + artist)) {
            out.put("artist", new JSONObject().put("id", MediaId.container(source + ":" + artist))
                    .put("title", Json.first(Json.str(meta, "artist"), Json.str(meta, "grandparentTitle"))).put("kind", books ? "author" : "artist"));
        }
        return out;
    }

    /** Progress of the given items from the household's recent list: {contentId: {playhead, duration, finished}}. */
    static JSONObject progress(JSONObject recent, java.util.Set<String> ids) throws JSONException {
        JSONObject out = new JSONObject();
        JSONArray items = recent == null ? null : recent.optJSONArray("items");
        for (int i = 0; items != null && i < items.length(); i++) {
            JSONObject r = items.optJSONObject(i);
            if (r == null) continue;
            String id = Json.str(r, "contentId");
            if (!ids.contains(id) || out.has(id)) continue;
            out.put(id, new JSONObject().put("playhead", r.optLong("playhead", 0)).put("duration", r.optLong("duration", 0))
                    .put("finished", r.optBoolean("finished", false)));
        }
        return out;
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
