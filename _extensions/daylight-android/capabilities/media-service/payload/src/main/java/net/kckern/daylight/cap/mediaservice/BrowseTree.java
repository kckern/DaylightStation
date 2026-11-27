package net.kckern.daylight.cap.mediaservice;

import net.kckern.daylight.core.backend.Backend;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Maps backend responses to browse nodes. Pure. Whatever in a response is not what
 * the backend documents is left out; nothing here throws on a response.
 */
final class BrowseTree {
    /** Android Auto shows the root's children as tabs: expect four, browsable only. */
    static final int MAX_ROOTS = 4;
    private static final int MAX_LABEL = 24;

    /** One browse level as it arrived: the usable nodes, how many items the answer held, and its total (-1 when it gave none). */
    static final class Level {
        final List<MediaNode> nodes;
        final int received;
        final int total;

        Level(List<MediaNode> nodes, int received, int total) {
            this.nodes = nodes;
            this.received = received;
            this.total = total;
        }
    }

    private BrowseTree() { }

    /** What is wrong with a media.roots value, as a settings rule says it; null when it can be used. */
    static String rootsProblem(String spec) {
        int count = 0;
        for (String entry : (spec == null ? "" : spec).split(";")) {
            if (entry.trim().isEmpty()) continue;
            if (root(entry) == null) return "must give each tab as Label=target, where a target is recent, continue, catalog, kept or a content id";
            count++;
        }
        if (count == 0) return "must name at least one tab, as Label=target";
        if (count > MAX_ROOTS) return "must have at most " + MAX_ROOTS + " tabs (a car shows no more)";
        return null;
    }

    /** spec: "Label=target;Label=target". Empty when the setting cannot be used; rootsProblem says why. */
    static List<MediaNode> roots(String spec) {
        List<MediaNode> out = new ArrayList<>();
        if (rootsProblem(spec) != null) return out;
        for (String entry : spec.split(";")) {
            if (!entry.trim().isEmpty()) out.add(root(entry));
        }
        return out;
    }

    private static MediaNode root(String entry) {
        int eq = entry.indexOf('=');
        if (eq < 0) return null;
        String label = entry.substring(0, eq).trim();
        String target = entry.substring(eq + 1).trim();
        if (label.isEmpty() || label.length() > MAX_LABEL) return null;
        String id;
        if (MediaId.RECENT.equals(target) || MediaId.CATALOG.equals(target) || MediaId.CONTINUE.equals(target)
                || MediaId.KEPT.equals(target)) id = target;
        else if (ContentId.valid(target)) id = MediaId.container(target);
        else return null;
        return new MediaNode(id, label, "", null, true, false);
    }

    /**
     * A GET /api/v1/list/... response. parentContentId is null for the root catalog.
     * The route copies an item's metadata onto the item itself (there is no metadata
     * object), and turns a string of digits into a number.
     */
    static Level fromList(JSONObject response, String parentContentId, Backend backend) {
        List<MediaNode> out = new ArrayList<>();
        JSONArray items = response == null ? null : response.optJSONArray("items");
        int received = items == null ? 0 : items.length();
        for (int i = 0; i < received; i++) {
            JSONObject item = items.optJSONObject(i);
            if (item == null) continue;
            String id = Json.str(item, "id");
            if (!ContentId.valid(id)) continue;
            String title = Json.first(Json.str(item, "title"), Json.str(item, "label"));
            if (title.isEmpty()) continue;
            String subtitle = Json.first(Json.str(item, "artist"), Json.str(item, "grandparentTitle"), Json.str(item, "parentTitle"));
            String art = art(backend, Json.str(item, "thumbnail"));
            MediaNode n = null;
            if ("container".equals(Json.str(item, "itemType"))) {
                n = new MediaNode(MediaId.container(id), title, subtitle, art, true, false);
            } else if (item.optJSONObject("play") != null && !NOT_AUDIO.contains(mediaType(item))) {
                // The route gives an item a play object only when it has a stream.
                n = new MediaNode(MediaId.leaf(id, parentContentId), title, subtitle, art, false, true);
            }
            if (n == null) continue;
            n.facts = facts(item);
            out.add(n);
        }
        int total = response != null && response.opt("total") instanceof Number ? response.optInt("total", -1) : -1;
        return new Level(out, received, total);
    }

    /**
     * A list item's facts for a phone row (year, durationSec, trackCount, artist), so the
     * shell never guesses them; null when it has none. The list route copies metadata onto
     * the item.
     */
    static JSONObject facts(JSONObject item) {
        try {
            JSONObject f = new JSONObject();
            String year = Json.str(item, "year");
            if (!year.isEmpty() && !"0".equals(year)) f.put("year", year);
            else {
                String released = Json.str(item, "originallyAvailableAt");
                if (released.length() >= 4 && !released.startsWith("0000")) f.put("year", released.substring(0, 4).replaceFirst("^0+(?=\\d)", ""));
            }
            long duration = item.optLong("duration", 0);
            if (duration > 0) f.put("durationSec", duration);
            int count = item.optInt("childCount", item.optInt("leafCount", 0));
            if (count > 0) f.put("trackCount", count);
            String artist = Json.first(Json.str(item, "artist"), Json.str(item, "grandparentTitle"));
            if (!artist.isEmpty()) f.put("artist", artist);
            if (ownArt(item)) f.put("ownArt", true);
            return f.length() == 0 ? null : f;
        } catch (JSONException impossible) {
            return null;
        }
    }

    /**
     * Whether a leaf has its own picture, not its album's or book's: a book's parts all
     * point at the book's thumb (/library/metadata/&lt;albumId&gt;/thumb/…), so a row shows the
     * part's number instead of the same cover again. A leaf with no parent id keeps its art.
     */
    static boolean ownArt(JSONObject item) {
        String thumb = Json.str(item, "thumbnail");
        if (thumb.isEmpty() || "container".equals(Json.str(item, "itemType"))) return false;
        String parent = Json.first(Json.str(item, "albumId"), Json.str(item, "parentId"));
        return parent.isEmpty() || !thumb.contains("/metadata/" + parent + "/");
    }

    static List<MediaNode> audioListSources(JSONObject response) {
        List<MediaNode> nodes = new ArrayList<>();
        JSONArray items = response.optJSONArray("items");
        for (int index = 0; items != null && index < items.length(); index++) {
            JSONObject item = items.optJSONObject(index);
            if (item == null) continue;
            String id = Json.str(item, "id");
            String title = Json.str(item, "title");
            if (ContentId.valid(id) && !title.isEmpty()) {
                nodes.add(new MediaNode(MediaId.audioSource(id, 0), title, "", null, true, false));
            }
        }
        return nodes;
    }

    static List<MediaNode> fromAudioListCatalog(JSONObject response, String parent, int skip, Backend backend) {
        List<MediaNode> nodes = new ArrayList<>();
        JSONArray items = response.optJSONArray("items");
        for (int index = 0; items != null && index < items.length(); index++) {
            JSONObject item = items.optJSONObject(index);
            if (item == null) continue;
            String id = Json.str(item, "id");
            String title = Json.str(item, "title");
            if (ContentId.valid(id) && !title.isEmpty()) {
                MediaNode n = new MediaNode(MediaId.audioList(id, 0), title, "", art(backend, Json.str(item, "thumbnail")), true, false);
                // A radio-station playlist (sequenced at home: station IDs between songs) plays whole; its tracks are not listed.
                if (item.optBoolean("station")) {
                    try { n.facts = new JSONObject().put("kind", "station"); } catch (JSONException impossible) { }
                }
                nodes.add(n);
            }
        }
        int next = response.optInt("nextCursor", -1);
        if (next > skip && next <= MediaId.MAX_SKIP) {
            nodes.add(new MediaNode(MediaId.audioSource(parent, next), "More lists", "", null, true, false));
        }
        return nodes;
    }

    static List<MediaNode> fromAudioQueue(JSONObject response, String parent, int skip, int pageSize, Backend backend) {
        List<MediaNode> nodes = new ArrayList<>();
        JSONArray items = response.optJSONArray("items");
        int count = items == null ? 0 : items.length();
        int end = Math.min(count, skip + pageSize);
        for (int index = skip; index < end; index++) {
            JSONObject item = items.optJSONObject(index);
            if (item == null || !"audio".equals(Json.str(item, "mediaType"))) continue;
            String id = QueueMapper.id(item);
            String title = Json.str(item, "title");
            if (!id.isEmpty() && !title.isEmpty()) {
                nodes.add(new MediaNode(MediaId.leaf(id, parent), title, Json.str(item, "artist"),
                        art(backend, Json.str(item, "thumbnail")), false, true));
            }
        }
        if (end < count && end <= MediaId.MAX_SKIP) {
            nodes.add(new MediaNode(MediaId.audioList(parent, end), "More tracks", "", null, true, false));
        }
        return nodes;
    }

    /** A GET /api/v1/media/household/recent response. An entry whose lookup failed has null display fields and is left out. */
    static List<MediaNode> fromRecent(JSONObject response, Backend backend) {
        List<MediaNode> out = new ArrayList<>();
        JSONArray items = response == null ? null : response.optJSONArray("items");
        for (int i = 0; items != null && i < items.length(); i++) {
            JSONObject item = items.optJSONObject(i);
            if (item == null) continue;
            String id = Json.str(item, "contentId");
            String title = Json.str(item, "title");
            if (!ContentId.valid(id) || title.isEmpty() || !RECENT_AUDIO.contains(mediaType(item))) continue;
            String subtitle = Json.first(Json.str(item, "grandparentTitle"), Json.str(item, "parentTitle"));
            long played = item.optLong("playhead", 0);
            long duration = item.optLong("duration", 0);
            if (!item.optBoolean("finished") && played >= 5 && (duration <= 0 || played < duration)) {
                String elapsed = android.text.format.DateUtils.formatElapsedTime(played);
                subtitle = "Resume at " + elapsed + (subtitle.isEmpty() ? "" : " · " + subtitle);
            }
            out.add(new MediaNode(MediaId.leaf(id, null), title, subtitle, art(backend, Json.str(item, "thumbnail")), false, true));
        }
        return out;
    }

    /** A long item is one of this many seconds or more: the phone's long-form line (CarControls.LONG_FORM_MS). */
    static final long CONTINUE_MIN_SECONDS = 20 * 60;

    /**
     * "Continue listening": long audio (a book, a course, a talk) started and not finished,
     * newest first, from a GET /api/v1/media/household/recent response. Each is
     * {id: the play node (resumes), contentId, title, subtitle, art, playhead, duration}
     * in seconds. Songs, video and anything finished or barely begun are left out.
     */
    static org.json.JSONArray continueItems(JSONObject response, Backend backend, int limit) throws org.json.JSONException {
        org.json.JSONArray out = new org.json.JSONArray();
        JSONArray items = response == null ? null : response.optJSONArray("items");
        java.util.Set<String> seen = new java.util.HashSet<>();
        for (int i = 0; items != null && i < items.length() && out.length() < limit; i++) {
            JSONObject item = items.optJSONObject(i);
            if (item == null) continue;
            String id = Json.str(item, "contentId");
            String title = Json.str(item, "title");
            if (!ContentId.valid(id) || title.isEmpty() || !RECENT_AUDIO.contains(mediaType(item)) || !seen.add(id)) continue;
            long played = item.optLong("playhead", 0), duration = item.optLong("duration", 0);
            if (item.optBoolean("finished") || duration < CONTINUE_MIN_SECONDS || played < 30) continue;
            if (played >= duration * 0.97) continue;
            String art = art(backend, Json.str(item, "thumbnail"));
            JSONObject o = new JSONObject().put("id", MediaId.leaf(id, null)).put("contentId", id).put("title", title)
                    .put("subtitle", Json.first(Json.str(item, "grandparentTitle"), Json.str(item, "parentTitle")))
                    .put("playhead", played).put("duration", duration);
            if (art != null) o.put("art", art);
            out.put(o);
        }
        return out;
    }

    /**
     * "Continue listening" from home's one answer (GET /api/v1/media/household/continue,
     * lookup spec §13): one row per book or series, each heard for at least the household's
     * minimum. Each is {id: the play node of the part to resume, contentId: the book (what
     * Remove and Mark finished act on), playContentId, title: the book, subtitle: the author,
     * art, playhead and duration of the part, remainingSec in the book, partTitle, partIndex,
     * partCount, legacy}. An older entry home has no listened time for comes with legacy true.
     */
    static JSONArray continueRows(JSONObject answer, Backend backend, int limit) throws org.json.JSONException {
        JSONArray out = new JSONArray();
        JSONArray items = answer == null ? null : answer.optJSONArray("items");
        java.util.Set<String> seen = new java.util.HashSet<>();
        for (int i = 0; items != null && i < items.length() && out.length() < limit; i++) {
            JSONObject item = items.optJSONObject(i);
            if (item == null) continue;
            String book = Json.str(item, "contentId");
            String play = Json.first(Json.str(item, "playContentId"), book);
            String title = Json.str(item, "title");
            if (!ContentId.valid(book) || !ContentId.valid(play) || title.isEmpty() || !seen.add(book)) continue;
            long played = item.optLong("playhead", 0), duration = item.optLong("duration", 0);
            JSONObject o = new JSONObject().put("id", MediaId.leaf(play, null)).put("contentId", book).put("playContentId", play)
                    .put("title", title).put("subtitle", Json.str(item, "byline"))
                    .put("playhead", played).put("duration", duration)
                    .put("remainingSec", item.has("remainingSec") ? item.optLong("remainingSec") : Math.max(0, duration - played))
                    .put("legacy", item.optBoolean("legacy"));
            String part = Json.str(item, "partTitle");
            if (!part.isEmpty() && !part.equalsIgnoreCase(title)) o.put("partTitle", part);
            if (item.optInt("partIndex", 0) > 0 && item.optInt("partCount", 0) > 1) {
                o.put("partIndex", item.optInt("partIndex")).put("partCount", item.optInt("partCount"));
            }
            String art = art(backend, Json.str(item, "thumbnail"));
            if (art != null) o.put("art", art);
            out.put(o);
        }
        return out;
    }

    /** Long audio's line: under this in all, an item is not Continue listening (home's LONG_FORM_SECONDS). */
    static final long LONG_FORM_SEC = 20 * 60;
    private static final java.util.Set<String> VIDEO_TYPES = new java.util.HashSet<>(java.util.Arrays.asList(
            "movie", "episode", "video", "clip", "show", "season"));
    private static final java.util.Set<String> NOT_LISTENING_KINDS = new java.util.HashSet<>(java.util.Arrays.asList(
            "music", "movies", "shows", "video"));

    /**
     * Continue listening on the phone is long audio only (2026-11-27: a film's audio and a
     * 79-second item in a books library showed there): never video or music, never an item
     * under 20 min in all. A book with several parts is long by its parts (its row's
     * duration is the current part's). Home answers the same since this date; this keeps a
     * phone right against a home that does not yet. Returns the answer with only those items.
     */
    static JSONObject listeningOnly(JSONObject answer) throws org.json.JSONException {
        JSONArray items = answer == null ? null : answer.optJSONArray("items");
        if (items == null) return answer;
        JSONArray kept = new JSONArray();
        for (int i = 0; i < items.length(); i++) {
            JSONObject item = items.optJSONObject(i);
            if (item != null && listening(item)) kept.put(item);
        }
        return new JSONObject(answer.toString()).put("items", kept);
    }

    static boolean listening(JSONObject item) {
        String type = Json.str(item, "type").toLowerCase(java.util.Locale.ROOT);
        String kind = Json.str(item, "kind").toLowerCase(java.util.Locale.ROOT);
        if (NOT_LISTENING_KINDS.contains(kind) || VIDEO_TYPES.contains(type)) return false;
        if (item.optInt("partCount", 0) > 1) return true;
        long duration = item.optLong("duration", 0);
        return duration <= 0 || duration >= LONG_FORM_SEC;
    }

    /** "Part 2 of 5 · 1 h 10 min left" for a book's row, or the time left alone. */
    static String continueLine(JSONObject row) {
        long left = row.has("remainingSec") ? row.optLong("remainingSec")
                : Math.max(0, row.optLong("duration") - row.optLong("playhead"));
        // The phone's one form for "left" (shell-kit TimeLeft): the whole book from its place, at 1×.
        long minutes = (Math.max(0, left) + 30) / 60;   // to the nearest minute, as TimeLeft
        String leftText = minutes >= 60 ? (minutes / 60) + " h " + (minutes % 60) + " min left"
                : minutes > 0 ? minutes + " min left" : "Under a minute left";
        int n = row.optInt("partIndex", 0), of = row.optInt("partCount", 0);
        return n > 0 && of > 1 ? "Part " + n + " of " + of + " · " + leftText : leftText;
    }

    /**
     * The car's Continue tab: long items in progress first (a tap resumes; the subtitle says
     * how much is left), then the lists played lately (a tap plays the list again).
     * {@code going} is continueRows' answer (or the older continueItems').
     */
    static List<MediaNode> continueNodes(JSONArray going, JSONArray lists) throws org.json.JSONException {
        List<MediaNode> out = new ArrayList<>();
        for (int i = 0; going != null && i < going.length(); i++) {
            JSONObject c = going.getJSONObject(i);
            String sub = c.optString("subtitle");
            String line = continueLine(c);
            out.add(new MediaNode(c.getString("id"), c.getString("title"), sub.isEmpty() ? line : line + " · " + sub,
                    c.optString("art", null), false, true));
        }
        java.util.Set<String> shown = new java.util.HashSet<>();
        for (int i = 0; lists != null && i < lists.length(); i++) {
            JSONObject l = lists.optJSONObject(i);
            if (l == null) continue;
            String id = l.optString("contentId");
            if (!ContentId.valid(id) || !shown.add(id)) continue;
            out.add(new MediaNode(MediaId.container(id), l.optString("title"), "Played lately", l.optString("art", null), false, true));
        }
        return out;
    }

    /**
     * The collections kept on this phone, newest kept first, one page of them: each opens to
     * its tracks and plays whole. Answered from the phone, never the network, so a car in a
     * dead zone lists them at once. {@code header} (offline) heads the list with what it is.
     */
    static List<MediaNode> keptNodes(List<JSONObject> kept, int pageSize, String header) {
        List<MediaNode> out = new ArrayList<>();
        if (header != null) out.add(new MediaNode(MediaId.KEPT, header, "Kept on this phone", null, true, false));
        for (JSONObject k : kept) {
            if (out.size() >= pageSize) break;
            String cid = k.optString("contentId");
            if (!ContentId.valid(cid)) continue;
            JSONArray tracks = k.optJSONArray("tracks");
            int n = tracks == null ? 0 : tracks.length();
            String art = k.has("art") ? k.optString("art") : null;
            out.add(new MediaNode(MediaId.container(cid), Json.first(k.optString("title"), "Kept"),
                    n + (n == 1 ? " track" : " tracks") + " · on this phone", art, true, true));
        }
        return out;
    }

    /** One kept collection's tracks (from the phone), each playing on from itself. */
    static List<MediaNode> keptTracks(JSONObject collection, int skip, int pageSize) {
        List<MediaNode> out = new ArrayList<>();
        JSONArray tracks = collection == null ? null : collection.optJSONArray("tracks");
        String cid = collection == null ? "" : collection.optString("contentId");
        for (int i = skip; tracks != null && i < tracks.length() && out.size() < pageSize; i++) {
            JSONObject t = tracks.optJSONObject(i);
            if (t == null || !ContentId.valid(t.optString("id"))) continue;
            out.add(new MediaNode(MediaId.leaf(t.optString("id"), cid), Json.first(t.optString("title"), "Untitled"),
                    Json.first(t.optString("artist"), t.optString("album")), t.has("artUrl") ? t.optString("artUrl") : null, false, true));
        }
        return out;
    }

    /** The longest query sent, in characters (code points). */
    static final int MAX_QUERY = 200;
    private static final java.util.Set<String> RECENT_AUDIO = new java.util.HashSet<>(java.util.Arrays.asList(
            "audio", "track", "song", "audiobook", "podcast"));

    private static String mediaType(JSONObject item) {
        JSONObject metadata = item.optJSONObject("metadata");
        return Json.first(Json.str(item, "mediaType"), Json.str(item, "type"),
                metadata == null ? "" : Json.str(metadata, "type")).trim().toLowerCase(java.util.Locale.ROOT);
    }

    /** Media types a search result may name that the native player does not play. */
    private static final java.util.Set<String> NOT_AUDIO = new java.util.HashSet<>(java.util.Arrays.asList(
            "video", "image", "photo", "movie", "episode", "show", "season", "clip", "dash_video", "hls_video", "readable", "book", "comic"));

    /**
     * A query as it is sent: control characters become spaces, the ends are trimmed and
     * runs of spaces collapse, cut to MAX_QUERY whole characters. "" for none.
     */
    static String searchText(String raw) {
        if (raw == null) return "";
        StringBuilder out = new StringBuilder();
        int count = 0;
        boolean space = false;
        for (int i = 0; i < raw.length() && count < MAX_QUERY; ) {
            int cp = raw.codePointAt(i);
            i += Character.charCount(cp);
            boolean blank = Character.isWhitespace(cp) || Character.isISOControl(cp) || Character.getType(cp) == Character.FORMAT;
            if (blank) { space = out.length() > 0; continue; }
            if (space) { out.append(' '); count++; space = false; if (count >= MAX_QUERY) break; }
            out.appendCodePoint(cp);
            count++;
        }
        return out.toString();
    }

    /**
     * A GET /api/v1/content/query/search response, as browse entries: a container to
     * browse, or an item with a stream to play. The same rules as a browse level: a
     * checked content id, a title, art only as an https URL on the backend, at most max
     * entries. An item whose media type is plainly not audio is left out (the player
     * would refuse it). Fields read: items[].id, title, itemType, mediaType, mediaUrl,
     * metadata.type, metadata.artist, subtitle, thumbnail (read from the backend's code;
     * the route has never been called by the app).
     */
    static List<MediaNode> fromSearch(JSONObject response, Backend backend, int max) {
        List<MediaNode> out = new ArrayList<>();
        JSONArray items = response == null ? null : response.optJSONArray("items");
        for (int i = 0; items != null && i < items.length() && out.size() < max; i++) {
            JSONObject item = items.optJSONObject(i);
            if (item == null) continue;
            String id = Json.str(item, "id");
            String title = Json.str(item, "title");
            if (!ContentId.valid(id) || title.isEmpty()) continue;
            JSONObject meta = item.optJSONObject("metadata");
            String subtitle = Json.first(meta == null ? "" : Json.str(meta, "artist"), Json.str(item, "subtitle"));
            String art = art(backend, Json.str(item, "thumbnail"));
            if ("container".equals(Json.str(item, "itemType"))) {
                out.add(new MediaNode(MediaId.container(id), title, subtitle, art, true, false));
                continue;
            }
            String type = mediaType(item);
            if (Json.str(item, "mediaUrl").isEmpty() || NOT_AUDIO.contains(type)) continue;
            out.add(new MediaNode(MediaId.leaf(id, null), title, subtitle, art, false, true));
        }
        return out;
    }

    /** What "play <query>" plays: the first entry, as an item (a container plays from its first item), or null. */
    static String best(List<MediaNode> nodes) {
        for (MediaNode n : nodes) {
            MediaId id;
            try { id = MediaId.parse(n.id); } catch (IllegalArgumentException notOurs) { continue; }
            if (id.kind == MediaId.Kind.LEAF) return n.id;
            if (id.kind == MediaId.Kind.CONTAINER && id.skip == 0 && n.id.startsWith("c:")) return MediaId.leaf(id.contentId, null);
        }
        return null;
    }

    /**
     * One level of a container as a car shows it: at most pageSize entries, and, when
     * the container holds more, one last browsable entry that leads to the next page.
     */
    static List<MediaNode> paged(Level level, String contentId, int skip, int pageSize) {
        List<MediaNode> out = new ArrayList<>(level.nodes.size() > pageSize ? level.nodes.subList(0, pageSize) : level.nodes);
        int next = skip + pageSize;
        boolean more = level.total >= 0 ? next < level.total : level.received >= pageSize;
        if (more && next <= MediaId.MAX_SKIP) {
            String title = level.total >= 0
                    ? "More (" + (next + 1) + " to " + Math.min(next + pageSize, level.total) + " of " + level.total + ")"
                    : "More";
            out.add(new MediaNode(MediaId.more(contentId, next), title, "", null, true, false));
        }
        return out;
    }

    /**
     * An image for a browse entry: an https URL on the backend, or null. A car's
     * projection app fetches the image itself, and is never handed a plain-http URL or
     * one on another host.
     */
    static String art(Backend backend, String ref) {
        String url;
        try { url = backend.absolute(ref); }
        catch (RuntimeException notConfigured) { return null; }
        return url != null && url.startsWith("https://") ? url : null;
    }
}
