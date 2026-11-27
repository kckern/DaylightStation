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
 * endpoints the web uses. Lookup, not discovery: nothing here proposes anything. What a
 * library holds (music, books, talks and courses) is home's word (LibraryKinds), and every
 * entry carries the kind of page or row it is: album, artist, playlist, track (music);
 * author, book, part (books); speaker, series, lecture (talks and courses). Pure.
 */
final class Lookup {
    private Lookup() { }

    /** The search groups, in the order the phone shows them. */
    static final String[] GROUPS = { "books", "talks", "albums", "artists", "playlists", "tracks" };
    static final String[] GROUP_TITLES = { "Books", "Talks and courses", "Albums", "Artists", "Playlists", "Tracks" };

    /** The kind of an album, an artist and a track in a library of {@code libraryKind}. */
    static String albumKind(String libraryKind) {
        return LibraryKinds.BOOKS.equals(libraryKind) ? "book" : LibraryKinds.TALKS.equals(libraryKind) ? "series" : "album";
    }

    static String artistKind(String libraryKind) {
        return LibraryKinds.BOOKS.equals(libraryKind) ? "author" : LibraryKinds.TALKS.equals(libraryKind) ? "speaker" : "artist";
    }

    static String trackKind(String libraryKind) {
        return LibraryKinds.BOOKS.equals(libraryKind) ? "part" : LibraryKinds.TALKS.equals(libraryKind) ? "lecture" : "track";
    }

    /**
     * The library's first level: every audio Plex library with its kind, from home's
     * audio-libraries answer ({items:[{id, title, kind}]}; with {@code kinds} from a home
     * without that route, the Plex libraries of type artist and the old title rule), then the
     * household's list sources (Plex's audio playlists as "Playlists", programs, watchlists,
     * custom lists). Each entry is {id: a browse media id, title, kind}.
     */
    static JSONArray libraryRoot(JSONObject libraries, JSONObject audioSources, LibraryKinds kinds) throws JSONException {
        JSONArray out = new JSONArray();
        JSONArray libs = libraries == null ? null : libraries.optJSONArray("items");
        for (int i = 0; libs != null && i < libs.length(); i++) {
            JSONObject l = libs.optJSONObject(i);
            if (l == null) continue;
            JSONObject meta = l.optJSONObject("metadata");
            String type = Json.first(meta == null ? "" : Json.str(meta, "type"), Json.str(l, "type"));
            String id = Json.str(l, "id"), title = Json.str(l, "title");
            // Home's audio libraries carry their kind; the list endpoint's are filtered to audio.
            boolean audio = !Json.str(l, "kind").isEmpty() || "artist".equals(type);
            if (!audio || !ContentId.valid(id) || title.isEmpty()) continue;
            String kind = Json.str(l, "kind").isEmpty() ? kinds.of(title, LibraryKinds.sectionOf(id)) : Json.str(l, "kind");
            out.put(new JSONObject().put("id", MediaId.container(id)).put("title", title)
                    .put("kind", LibraryKinds.libraryTag(kind)));
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

    /**
     * The kind of a search item (album, author, lecture…), or null when the phone does not
     * play it.
     */
    static String kindOf(JSONObject item, LibraryKinds kinds) {
        JSONObject meta = item.optJSONObject("metadata");
        String type = meta == null ? "" : Json.str(meta, "type");
        String library = kinds.ofItem(item);
        if ("container".equals(Json.str(item, "itemType"))) {
            switch (type) {
                case "album": return albumKind(library);
                case "artist": return artistKind(library);
                case "playlist": return "playlist";
                default: return null;   // shows, seasons, films: not for this player
            }
        }
        String media = Json.first(Json.str(item, "mediaType"), type).toLowerCase(Locale.ROOT);
        if (Json.str(item, "mediaUrl").isEmpty() && !"track".equals(type)) return null;
        if (!media.isEmpty() && !media.equals("audio") && !media.equals("track")) return null;
        return trackKind(library);
    }

    /** The search group of a kind: a book part is under Books and a lecture under Talks and courses, never Tracks. */
    static String groupOfKind(String kind) {
        if (kind == null) return null;
        switch (kind) {
            case "book": case "author": case "part": return "books";
            case "series": case "speaker": case "lecture": return "talks";
            case "album": return "albums";
            case "artist": return "artists";
            case "playlist": return "playlists";
            default: return "tracks";
        }
    }

    /** Which group a search item belongs to, or null when the phone does not play it. */
    static String groupOf(JSONObject item, LibraryKinds kinds) { return groupOfKind(kindOf(item, kinds)); }

    /**
     * Search results by group: {groups:[{key, title, items:[{id, contentId, title,
     * subtitle?, artUrl?, kind, browsable, playable}], more}], offline:false}. At most
     * {@code perGroup} items each; "more" says how many were left out.
     */
    static JSONObject groups(JSONObject response, Backend backend, int perGroup, LibraryKinds kinds) throws JSONException {
        JSONArray[] buckets = new JSONArray[GROUPS.length];
        int[] more = new int[GROUPS.length];
        for (int g = 0; g < GROUPS.length; g++) buckets[g] = new JSONArray();
        JSONArray items = response == null ? null : response.optJSONArray("items");
        for (int i = 0; items != null && i < items.length(); i++) {
            JSONObject item = items.optJSONObject(i);
            if (item == null) continue;
            String id = Json.str(item, "id"), title = Json.str(item, "title");
            String kind = kindOf(item, kinds);
            String group = groupOfKind(kind);
            if (group == null || !ContentId.valid(id) || title.isEmpty()) continue;
            int g = java.util.Arrays.asList(GROUPS).indexOf(group);
            if (buckets[g].length() >= perGroup) { more[g]++; continue; }
            JSONObject meta = item.optJSONObject("metadata");
            boolean track = !"container".equals(Json.str(item, "itemType"));
            JSONObject o = new JSONObject().put("contentId", id).put("title", title).put("kind", kind)
                    .put("id", track ? MediaId.leaf(id, null) : MediaId.container(id))
                    .put("browsable", !track).put("playable", true);
            String year = meta == null ? "" : Json.str(meta, "year");
            if (!year.isEmpty() && !"0".equals(year)) o.put("year", year);
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
                    .put("kind", "book").put("browsable", true).put("playable", true);
            if (author != null && !author.isEmpty()) o.put("subtitle", author);
            String year = Json.str(c, "year");
            if (!year.isEmpty() && !"0".equals(year)) o.put("year", year);
            String art = backend == null ? null : BrowseTree.art(backend, Json.str(c, "thumbnail"));
            if (art != null) o.put("artUrl", art);
            out.put(o);
        }
        return out;
    }

    /** Authors (artists in a book library) among search results: their content ids and names. */
    static java.util.List<String[]> authors(JSONObject response, int max, LibraryKinds kinds) {
        java.util.List<String[]> out = new java.util.ArrayList<>();
        JSONArray items = response == null ? null : response.optJSONArray("items");
        for (int i = 0; items != null && i < items.length() && out.size() < max; i++) {
            JSONObject item = items.optJSONObject(i);
            if (item == null || !"container".equals(Json.str(item, "itemType"))) continue;
            JSONObject meta = item.optJSONObject("metadata");
            if (meta == null || !"artist".equals(Json.str(meta, "type"))) continue;
            if (!LibraryKinds.BOOKS.equals(kinds.ofItem(item)) || !ContentId.valid(Json.str(item, "id"))) continue;
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
     * as browse media ids, a book library's being a book and an author, a talks library's a
     * series and a speaker.
     */
    static JSONObject parents(JSONObject info, LibraryKinds kinds) throws JSONException {
        JSONObject out = new JSONObject();
        JSONObject meta = info == null ? null : info.optJSONObject("metadata");
        if (meta == null) return out;
        String source = ContentId.source(Json.first(Json.str(info, "contentId"), Json.str(info, "id"), "plex:0"));
        String library = kinds.ofItem(info);
        String album = Json.str(meta, "albumId"), artist = Json.str(meta, "artistId");
        if (!album.isEmpty() && ContentId.valid(source + ":" + album)) {
            out.put("album", new JSONObject().put("id", MediaId.container(source + ":" + album))
                    .put("title", Json.first(Json.str(meta, "album"), Json.str(meta, "parentTitle"))).put("kind", albumKind(library)));
        }
        if (!artist.isEmpty() && ContentId.valid(source + ":" + artist)) {
            out.put("artist", new JSONObject().put("id", MediaId.container(source + ":" + artist))
                    .put("title", Json.first(Json.str(meta, "artist"), Json.str(meta, "grandparentTitle"))).put("kind", artistKind(library)));
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

    /** Lowercase, with "&" read as "and", so "Snakes and Arrows" finds "Snakes & Arrows" (as home's search does). */
    static String fold(String text) {
        return text.toLowerCase(Locale.ROOT).replace("&", " and ").trim().replaceAll("\\s+", " ");
    }

    /**
     * Search with no home: the collections kept on this phone whose title holds every word
     * of the query, as one group ("On this phone"), {groups, offline:true}.
     */
    static JSONObject offline(List<JSONObject> kept, String text) throws JSONException {
        String[] words = text == null ? new String[0] : fold(text).split("\\s+");
        JSONArray hits = new JSONArray();
        for (JSONObject k : kept) {
            String title = k.optString("title", "");
            String hay = fold(title);
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
