package net.kckern.daylight.cap.mediaservice;

import net.kckern.daylight.core.backend.Backend;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * An author's or an artist's page header (ops:docs/superpowers/specs/2026-11-26-phone-lookup-and-browse.md
 * §8a): who they are, from home's info answer (the portrait, the summary, Plex's Country,
 * Genre and Style tags), and for an author or a speaker their books from the tracks under
 * them (the list endpoint's allLeaves of the author: each track's book and length) with
 * each book's progress from the household's recent list. Pure.
 *
 * <p>{portrait?, summary?, countries[], genres[], styles[], children, totalSec, books:{<book
 * content id>: {seconds, parts[], playedSec, started, finished}}, continue?: {id, title,
 * partId}}. "continue" is the started, unfinished book played last.
 */
final class About {
    private About() { }

    static JSONObject of(JSONObject info, JSONObject leaves, JSONObject recent, Backend backend) throws JSONException {
        JSONObject out = new JSONObject();
        JSONObject meta = info == null ? null : info.optJSONObject("metadata");
        String art = backend == null || info == null ? null : BrowseTree.art(backend, Json.first(Json.str(info, "thumbnail"), Json.str(info, "image")));
        if (art != null) out.put("portrait", art);
        String summary = meta == null ? "" : Json.str(meta, "summary").trim();
        if (!summary.isEmpty()) out.put("summary", summary);
        out.put("countries", tags(meta, "countries")).put("genres", tags(meta, "genres")).put("styles", tags(meta, "styles"));
        out.put("children", meta == null ? 0 : meta.optInt("childCount", 0));

        // The books, in the order the tracks came (the author's order), with their parts.
        Map<String, JSONObject> books = new LinkedHashMap<>();
        Map<String, String> bookOfPart = new HashMap<>();
        JSONArray items = leaves == null ? null : leaves.optJSONArray("items");
        long total = 0;
        String source = info == null ? "plex" : ContentId.valid(Json.str(info, "id")) ? ContentId.source(Json.str(info, "id")) : "plex";
        for (int i = 0; items != null && i < items.length(); i++) {
            JSONObject t = items.optJSONObject(i);
            if (t == null) continue;
            String id = Json.str(t, "id"), album = Json.str(t, "albumId");
            if (!ContentId.valid(id) || album.isEmpty()) continue;
            String book = album.contains(":") ? album : source + ":" + album;
            if (!ContentId.valid(book)) continue;
            long sec = Math.max(0, t.optLong("duration", 0));
            JSONObject b = books.get(book);
            if (b == null) {
                b = new JSONObject().put("seconds", 0L).put("parts", new JSONArray()).put("title", Json.str(t, "album"));
                books.put(book, b);
            }
            b.put("seconds", b.getLong("seconds") + sec);
            b.getJSONArray("parts").put(new JSONObject().put("id", id).put("seconds", sec));
            bookOfPart.put(id, book);
            total += sec;
        }
        out.put("totalSec", total);
        if (!books.isEmpty()) out.put("children", books.size());

        // Each book's progress: its parts' places in the recent list (newest first).
        Map<String, JSONObject> placeOf = new HashMap<>();
        String lastStarted = null, lastPart = null;
        JSONArray rec = recent == null ? null : recent.optJSONArray("items");
        for (int i = 0; rec != null && i < rec.length(); i++) {
            JSONObject r = rec.optJSONObject(i);
            if (r == null) continue;
            String id = Json.str(r, "contentId");
            if (!bookOfPart.containsKey(id) || placeOf.containsKey(id)) continue;
            placeOf.put(id, r);
        }
        JSONObject outBooks = new JSONObject();
        for (Map.Entry<String, JSONObject> e : books.entrySet()) {
            JSONObject b = e.getValue();
            JSONArray parts = b.getJSONArray("parts");
            long played = 0;
            boolean any = false, all = parts.length() > 0;
            for (int p = 0; p < parts.length(); p++) {
                JSONObject part = parts.getJSONObject(p);
                long d = part.getLong("seconds");
                JSONObject r = placeOf.get(part.getString("id"));
                boolean done = r != null && (r.optBoolean("finished") || (d > 0 && r.optLong("playhead") >= d * 0.97));
                long at = r == null ? 0 : Math.max(0, Math.min(d, r.optLong("playhead")));
                if (r != null && (done || at >= 30)) any = true;
                played += done ? d : at;
                if (!done) all = false;
            }
            b.put("playedSec", played).put("started", any).put("finished", all && any);
            outBooks.put(e.getKey(), b);
        }
        // The book to continue: the one whose part was played last, started and not finished.
        for (int i = 0; rec != null && i < rec.length() && lastStarted == null; i++) {
            JSONObject r = rec.optJSONObject(i);
            String id = r == null ? "" : Json.str(r, "contentId");
            String book = bookOfPart.get(id);
            if (book == null) continue;
            JSONObject b = outBooks.getJSONObject(book);
            if (b.getBoolean("started") && !b.getBoolean("finished")) { lastStarted = book; lastPart = id; }
        }
        out.put("books", outBooks);
        if (lastStarted != null) {
            out.put("continue", new JSONObject().put("id", lastStarted).put("partId", lastPart)
                    .put("title", outBooks.getJSONObject(lastStarted).optString("title")));
        }
        return out;
    }

    /** Plex's tags as info passes them (metadata.countries etc.: strings), at most four. */
    private static JSONArray tags(JSONObject meta, String key) {
        JSONArray out = new JSONArray();
        JSONArray in = meta == null ? null : meta.optJSONArray(key);
        for (int i = 0; in != null && i < in.length() && out.length() < 4; i++) {
            Object v = in.opt(i);
            String s = v instanceof String ? ((String) v).trim() : v instanceof JSONObject ? Json.str((JSONObject) v, "tag").trim() : "";
            if (!s.isEmpty()) out.put(s);
        }
        return out;
    }
}
