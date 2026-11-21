package net.kckern.daylight.cap.mediaservice;

import net.kckern.daylight.core.backend.Backend;

import org.json.JSONArray;
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
            if (root(entry) == null) return "must give each tab as Label=target, where a target is recent, catalog or a content id";
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
        if (MediaId.RECENT.equals(target) || MediaId.CATALOG.equals(target)) id = target;
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
            if ("container".equals(Json.str(item, "itemType"))) {
                out.add(new MediaNode(MediaId.container(id), title, subtitle, art, true, false));
            } else if (item.optJSONObject("play") != null && !NOT_AUDIO.contains(mediaType(item))) {
                // The route gives an item a play object only when it has a stream.
                out.add(new MediaNode(MediaId.leaf(id, parentContentId), title, subtitle, art, false, true));
            }
        }
        int total = response != null && response.opt("total") instanceof Number ? response.optInt("total", -1) : -1;
        return new Level(out, received, total);
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
                nodes.add(new MediaNode(MediaId.audioList(id, 0), title, "",
                        art(backend, Json.str(item, "thumbnail")), true, false));
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
