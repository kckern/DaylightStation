package net.kckern.daylight.cap.onetap;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * The media actions pinned at a page's request (the page bridge's pinMedia) and
 * confirmed by the owner in the launcher's dialog, oldest first, at most MAX. Pure: the capability persists toJson() in the app's private
 * state directory and reads it back with fromJson().
 *
 * A pinned action's id is derived from its content id ("media-" and twelve hex digits
 * of its SHA-256), so pinning the same content again is the same action, and the id
 * says nothing about the content. The content id is checked by media-service before it
 * reaches here; this class only refuses what it could not have written.
 */
final class PinnedMedia {
    static final int MAX = 24;
    static final int MAX_LABEL = 40;

    static final class Entry {
        final String id;
        final String contentId;
        final String label;
        final long atMs;

        Entry(String contentId, String label, long atMs) {
            this.id = idFor(contentId);
            this.contentId = contentId;
            this.label = label;
            this.atMs = atMs;
        }
    }

    private final List<Entry> entries = new ArrayList<>();

    static String idFor(String contentId) {
        try {
            byte[] h = MessageDigest.getInstance("SHA-256").digest(contentId.getBytes(StandardCharsets.UTF_8));
            StringBuilder s = new StringBuilder("media-");
            for (int i = 0; i < 6; i++) s.append(String.format("%02x", h[i]));
            return s.toString();
        } catch (Exception noSha256) {
            throw new IllegalStateException("SHA-256 is missing");
        }
    }

    List<Entry> all() { return Collections.unmodifiableList(entries); }

    Entry find(String id) {
        for (Entry e : entries) if (e.id.equals(id)) return e;
        return null;
    }

    boolean full() { return entries.size() >= MAX; }

    /**
     * Adds a pin, or renames an existing one and makes it the newest. A new pin when
     * MAX are already kept is refused: no pin the owner made is pushed out for it.
     *
     * @return whether the pin is now kept
     */
    boolean add(String contentId, String label, long nowMs) {
        Entry existing = find(idFor(contentId));
        if (existing == null && full()) return false;
        if (existing != null) entries.remove(existing);
        entries.add(new Entry(contentId, label, nowMs));
        return true;
    }

    /**
     * Keeps the entries whose action id is in the set (the ones whose shortcut the
     * launcher still holds), so a shortcut the owner removed frees its slot.
     *
     * @return the entries dropped
     */
    List<Entry> retainOnly(java.util.Set<String> actionIds) {
        List<Entry> dropped = new ArrayList<>();
        for (java.util.Iterator<Entry> it = entries.iterator(); it.hasNext(); ) {
            Entry e = it.next();
            if (!actionIds.contains(e.id)) {
                dropped.add(e);
                it.remove();
            }
        }
        return dropped;
    }

    String toJson() {
        JSONArray pins = new JSONArray();
        try {
            for (Entry e : entries) pins.put(new JSONObject().put("contentId", e.contentId).put("label", e.label).put("at", e.atMs));
            return new JSONObject().put("pins", pins).toString();
        } catch (Exception impossible) {
            return "{\"pins\":[]}";
        }
    }

    /** What the file holds; an entry that is not whole, or a file that is not this shape, is left out. */
    static PinnedMedia fromJson(String json) {
        PinnedMedia p = new PinnedMedia();
        if (json == null) return p;
        try {
            JSONArray pins = new JSONObject(json).optJSONArray("pins");
            // A file written by an earlier build may hold more than MAX: the newest are kept.
            int from = pins == null ? 0 : Math.max(0, pins.length() - MAX);
            for (int i = from; pins != null && i < pins.length(); i++) {
                JSONObject o = pins.optJSONObject(i);
                if (o == null) continue;
                String contentId = o.optString("contentId", "");
                String label = o.optString("label", "");
                if (!plainContentId(contentId) || !plainLabel(label)) continue;
                p.add(contentId, label, o.optLong("at", 0));
            }
        } catch (Exception notThisShape) {
            return new PinnedMedia();
        }
        return p;
    }

    private static boolean plainContentId(String s) {
        if (s.isEmpty() || s.length() > 400 || s.indexOf(':') <= 0) return false;
        for (int i = 0; i < s.length(); i++) if (s.charAt(i) < 0x20 || s.charAt(i) == 0x7f) return false;
        return true;
    }

    /** The label rule media-service applied, for what is read back from the file. */
    static boolean plainLabel(String s) {
        if (s == null || s.trim().isEmpty() || s.codePointCount(0, s.length()) > MAX_LABEL) return false;
        for (int i = 0; i < s.length(); ) {
            int cp = s.codePointAt(i);
            int type = Character.getType(cp);
            if (type == Character.CONTROL || type == Character.FORMAT || type == Character.SURROGATE
                    || type == Character.LINE_SEPARATOR || type == Character.PARAGRAPH_SEPARATOR) return false;
            i += Character.charCount(cp);
        }
        return true;
    }
}
