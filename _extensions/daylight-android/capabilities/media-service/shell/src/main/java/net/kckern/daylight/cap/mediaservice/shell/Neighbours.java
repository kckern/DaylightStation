package net.kckern.daylight.cap.mediaservice.shell;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Paging a detail page through the list it was opened from
 * (ops:docs/superpowers/specs/2026-11-26-phone-lookup-and-browse.md §9): exactly that list,
 * in its order (an author's books, the Audiobooks level's authors, a search group), only
 * the entries that open a page of their own. Opened by a link with no list: no paging. Pure.
 */
final class Neighbours {
    /** One entry: what its list row showed, so a page not loaded yet draws at once. */
    static final class Entry {
        final String id, title, subtitle, art, kind;
        Entry(String id, String title, String subtitle, String art, String kind) {
            this.id = id; this.title = title; this.subtitle = subtitle; this.art = art; this.kind = kind;
        }
        JSONObject toJson() {
            try { return new JSONObject().put("id", id).put("title", title).put("subtitle", subtitle).put("art", art).put("kind", kind); }
            catch (Exception impossible) { return new JSONObject(); }
        }
    }

    final List<Entry> entries;
    int index;

    Neighbours(List<Entry> entries, int index) {
        this.entries = entries;
        this.index = entries.isEmpty() ? -1 : Math.max(0, Math.min(entries.size() - 1, index));
    }

    static final Neighbours NONE = new Neighbours(new ArrayList<>(), -1);

    /**
     * From a list's rows ({id, title, subtitle, artUrl, kind, browsable}): the ones that open a
     * page of the same family as the opened one; {@code at} is the opened one's id. A search
     * group can mix kinds (2026-11-27: an author's neighbours were a book about him and
     * another author): an author pages through artists and authors only, a book through
     * books, an album through albums and playlists.
     */
    static Neighbours fromRows(List<JSONObject> rows, String at, String defaultKind) {
        List<Entry> all = new ArrayList<>();
        String atFamily = null;
        for (JSONObject r : rows) {
            String id = r.optString("id");
            boolean browsable = r.optBoolean("browsable", id.startsWith("c:") || id.startsWith("a:"));
            if (id.isEmpty() || id.startsWith("m:") || !browsable) continue;
            String kind = r.optString("kind", "");
            if (kind.isEmpty()) kind = defaultKind;
            if (!MediaKind.detail(kind)) continue;
            if (id.equals(at)) atFamily = family(kind);
            all.add(new Entry(id, r.optString("title", ""), r.optString("subtitle", ""), r.optString("artUrl", ""), kind));
        }
        if (atFamily == null) return NONE;
        List<Entry> out = new ArrayList<>();
        int index = -1;
        for (Entry e : all) {
            if (!atFamily.equals(family(e.kind))) continue;
            if (e.id.equals(at)) index = out.size();
            out.add(e);
        }
        return new Neighbours(out, index);
    }

    /** People (artists, authors, speakers), books (books, series) or music lists (albums, playlists, stations). */
    static String family(String kind) {
        switch (MediaKind.normal(kind)) {
            case "artist": case "author": case "speaker": return "people";
            case "book": case "series": return "books";
            default: return "lists";
        }
    }

    static Neighbours parse(String json, int index) {
        List<Entry> out = new ArrayList<>();
        try {
            JSONArray a = new JSONArray(json == null || json.isEmpty() ? "[]" : json);
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.getJSONObject(i);
                out.add(new Entry(o.optString("id"), o.optString("title"), o.optString("subtitle"), o.optString("art"), o.optString("kind")));
            }
        } catch (Exception unreadable) { return NONE; }
        if (index < 0 || index >= out.size()) return NONE;
        return new Neighbours(out, index);
    }

    String toJson() {
        JSONArray a = new JSONArray();
        for (Entry e : entries) a.put(e.toJson());
        return a.toString();
    }

    boolean pages() { return entries.size() > 1 && index >= 0; }

    Entry current() { return index >= 0 ? entries.get(index) : null; }

    /** The entry {@code direction} away (+1 next, -1 previous), or null at the edge. */
    Entry at(int direction) {
        int i = index + direction;
        return index < 0 || i < 0 || i >= entries.size() ? null : entries.get(i);
    }

    /** Moves one step; false at the edge (nothing changes). */
    boolean move(int direction) {
        if (at(direction) == null) return false;
        index += direction;
        return true;
    }

    /** The header's line: "‹ Dante · Thomas More ›", one side alone at an edge, "" with no paging. */
    String line() {
        if (!pages()) return "";
        Entry p = at(-1), n = at(1);
        if (p != null && n != null) return "‹ " + p.title + " · " + n.title + " ›";
        if (p != null) return "‹ " + p.title;
        return n == null ? "" : n.title + " ›";
    }
}
