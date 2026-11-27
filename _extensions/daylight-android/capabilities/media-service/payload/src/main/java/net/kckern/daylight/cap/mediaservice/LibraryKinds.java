package net.kckern.daylight.cap.mediaservice;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * What each audio library holds (ops:docs/superpowers/specs/2026-11-26-phone-lookup-and-browse.md
 * §8): music, books, or talks and courses. Home says so, per library, in its audio-libraries
 * answer (the household media config's play_on_demand.library_kinds); the phone never reads
 * it from a library's title. A home older than that route answers 404: then, and only then,
 * the title rule this replaced is used, so the app keeps working until home is updated. Pure.
 */
final class LibraryKinds {
    static final String MUSIC = "music", BOOKS = "books", TALKS = "talks";

    private final Map<String, String> byId = new HashMap<>(), byTitle = new HashMap<>();
    private final String fallback;
    /** Whether home said the kinds (false: a home without the route, the title rule). */
    final boolean fromHome;

    private LibraryKinds(boolean fromHome, String fallback) {
        this.fromHome = fromHome;
        this.fallback = fallback;
    }

    /** Home's answer: {items:[{id, title, sectionId?, kind}], default?}. */
    static LibraryKinds of(JSONObject answer) {
        LibraryKinds k = new LibraryKinds(true, known(answer == null ? "" : Json.str(answer, "default"), MUSIC));
        JSONArray items = answer == null ? null : answer.optJSONArray("items");
        for (int i = 0; items != null && i < items.length(); i++) {
            JSONObject l = items.optJSONObject(i);
            if (l == null) continue;
            String kind = known(Json.str(l, "kind"), k.fallback);
            String section = Json.str(l, "sectionId");
            if (section.isEmpty()) section = sectionOf(Json.str(l, "id"));
            if (!section.isEmpty()) k.byId.put(section, kind);
            String title = Json.str(l, "title");
            if (!title.isEmpty()) k.byTitle.put(title.toLowerCase(Locale.ROOT), kind);
        }
        return k;
    }

    /** A home without the audio-libraries route: the title rule this replaced, until home is updated. */
    static LibraryKinds legacy() { return new LibraryKinds(false, MUSIC); }

    /** The kind of a library, by its section id or its title. */
    String of(String libraryTitle, String sectionId) {
        if (sectionId != null && byId.containsKey(sectionId)) return byId.get(sectionId);
        String t = libraryTitle == null ? "" : libraryTitle.toLowerCase(Locale.ROOT);
        if (byTitle.containsKey(t)) return byTitle.get(t);
        if (!fromHome && (t.contains("book") || t.contains("stor") || t.contains("speech"))) return BOOKS;
        return fallback;
    }

    /** The kind of the library an item is in (its metadata's librarySectionID / librarySectionTitle). */
    String ofItem(JSONObject item) {
        JSONObject meta = item == null ? null : item.optJSONObject("metadata");
        JSONObject from = meta != null ? meta : item;
        if (from == null) return fallback;
        String title = Json.first(Json.str(from, "librarySectionTitle"), Json.str(from, "library"),
                Json.str(item, "librarySectionTitle"));
        String section = Json.first(Json.str(from, "librarySectionID"), Json.str(item, "librarySectionID"));
        return of(title, section);
    }

    /** "library-books", "library-talks" or "library" (music): what the phone's page for the library is. */
    static String libraryTag(String kind) {
        return BOOKS.equals(kind) ? "library-books" : TALKS.equals(kind) ? "library-talks" : "library";
    }

    /** The section id of a "plex:library/sections/<n>/all" id, or "". */
    static String sectionOf(String id) {
        String p = "plex:library/sections/";
        if (id == null || !id.startsWith(p)) return "";
        String rest = id.substring(p.length());
        int slash = rest.indexOf('/');
        return slash > 0 ? rest.substring(0, slash) : rest;
    }

    private static String known(String kind, String fallback) {
        return MUSIC.equals(kind) || BOOKS.equals(kind) || TALKS.equals(kind) ? kind : fallback;
    }
}
