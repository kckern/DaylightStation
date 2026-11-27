package net.kckern.daylight.cap.mediaservice.shell;

import androidx.media3.common.C;

import net.kckern.daylight.api.PayloadPort;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Collections;
import java.util.List;

/**
 * The installed media service's three questions to the payload, over the "media"
 * PayloadPort: in process, as JSON text. No Android types, and no media knowledge:
 * what a level holds, what an id plays and when progress is reported are the
 * payload's answers.
 */
final class PayloadMedia {
    /** The payload's media-service capability attaches to a port of this name. */
    static final String PORT = "media";

    private final PayloadPort port = PayloadPort.named(PORT);

    /** @throws PayloadPort.NotReadyException when no payload attached within the wait */
    String browse(String parent, int page, int pageSize, long waitMs) throws Exception {
        return port.call(new JSONObject().put("op", "browse").put("parent", parent).put("page", page)
                .put("pageSize", pageSize).toString(), waitMs);
    }

    TrackAnswer resolveShortcut(String mediaId, long waitMs) throws Exception {
        return resolveShortcut(mediaId, false, waitMs);
    }

    TrackAnswer resolveShortcut(String mediaId, boolean shuffle, long waitMs) throws Exception {
        return TrackAnswer.parse(resolve(Collections.singletonList(mediaId), C.INDEX_UNSET, false, shuffle, waitMs));
    }

    String resolve(List<String> mediaIds, int startIndex, boolean explicitPosition, long waitMs) throws Exception {
        return resolve(mediaIds, startIndex, explicitPosition, false, waitMs);
    }

    String resolve(List<String> mediaIds, int startIndex, boolean explicitPosition, boolean shuffle, long waitMs) throws Exception {
        JSONObject request = new JSONObject().put("op", "resolve").put("ids", new JSONArray(mediaIds));
        if (startIndex >= 0) request.put("startIndex", startIndex);
        if (explicitPosition) request.put("explicitPosition", true);
        if (shuffle) request.put("shuffle", true);
        return port.call(request.toString(), waitMs);
    }

    /** The phone's search: results grouped by kind, audio only; offline, what is kept. */
    String lookup(String query, long waitMs) throws Exception {
        return port.call(new JSONObject().put("op", "lookup").put("query", query == null ? "" : query).toString(), waitMs);
    }

    /** A track's album and artist as library pages: {parents:{album?, artist?}}. */
    String parents(String contentId, long waitMs) throws Exception {
        return port.call(new JSONObject().put("op", "parents").put("id", contentId).toString(), waitMs);
    }

    /** The household's progress for these items: {progress:{contentId:{playhead, duration, finished}}}. */
    String progress(java.util.List<String> contentIds, long waitMs) throws Exception {
        return port.call(new JSONObject().put("op", "progress").put("ids", new org.json.JSONArray(contentIds)).toString(), waitMs);
    }

    /** Marks these items finished (or not) for the household. */
    /** Save as playlist: {ok, id: "menu:<name>", title, count}. Items are {id: content id, title}. */
    String savePlaylist(String title, JSONArray items, long waitMs) throws Exception {
        return port.call(new JSONObject().put("op", "save-playlist").put("title", title).put("items", items).toString(), waitMs);
    }

    String markFinished(java.util.List<String> contentIds, boolean finished, long waitMs) throws Exception {
        return port.call(new JSONObject().put("op", "mark-finished").put("ids", new org.json.JSONArray(contentIds))
                .put("finished", finished).toString(), waitMs);
    }

    /**
     * An author's, speaker's or artist's header: {about:{portrait?, summary?, countries,
     * genres, styles, children, totalSec, books:{id:{seconds, playedSec, started, finished}},
     * continue?}}. {@code books}: an author or a speaker (their books' lengths and progress).
     */
    String about(String contentId, boolean books, long waitMs) throws Exception {
        return port.call(new JSONObject().put("op", "about").put("id", contentId).put("books", books).toString(), waitMs);
    }

    /** The library's first level: the audio libraries and the household's list sources. */
    String library(long waitMs) throws Exception {
        return port.call(new JSONObject().put("op", "library").toString(), waitMs);
    }

    /** A car's voice search. The query goes to the payload as it came; the payload cuts and cleans it. */
    String search(String query, long waitMs) throws Exception {
        return port.call(new JSONObject().put("op", "search").put("query", query == null ? "" : query).toString(), waitMs);
    }

    /**
     * A tap on a widget or a tile handed the play service an action id. The payload
     * answers with the media id of that action's content, or refuses.
     */
    String playlistSources(long waitMs) throws Exception {
        return port.call(new JSONObject().put("op", "playlistSources").toString(), waitMs);
    }

    String playlists(String source, int cursor, long waitMs) throws Exception {
        return port.call(new JSONObject().put("op", "playlists").put("source", source)
                .put("cursor", String.valueOf(cursor)).toString(), waitMs);
    }

    String action(String actionId, long waitMs) throws Exception {
        return port.call(new JSONObject().put("op", "action").put("action", actionId).toString(), waitMs);
    }

    /**
     * The player's position. Progress is advisory: with no payload, or one that throws,
     * the event is dropped and the next carries a later position.
     *
     * @return whether a payload took it
     */
    boolean event(String id, String title, String listId, long positionMs, long durationMs, String state) {
        return event(id, title, listId, positionMs, durationMs, state, 1f);
    }

    /** @param rate the playback speed (1 for normal), sent with the report so home counts listened time at it */
    boolean event(String id, String title, String listId, long positionMs, long durationMs, String state, float rate) {
        try {
            port.call(new JSONObject().put("op", "event").put("id", id).put("title", title).put("listId", listId)
                    .put("positionMs", positionMs).put("durationMs", durationMs).put("state", state)
                    .put("rate", (double) rate).toString(), 0);
            return true;
        } catch (Throwable dropped) {
            return false;
        }
    }

    /** The player's household rules: {ok, crossfadeSec} (media.crossfadeSec). */
    String playerRules(long waitMs) throws Exception {
        return port.call(new JSONObject().put("op", "playerRules").toString(), waitMs);
    }

    /** The screens this phone can be a remote for: {ok, items:[{id, name}]}. */
    String screens(long waitMs) throws Exception {
        return port.call(new JSONObject().put("op", "screens").toString(), waitMs);
    }

    /** What one screen is doing now: {ok, status, snapshot?, lastSeenAt?}. */
    String screenSession(String device, long waitMs) throws Exception {
        return port.call(new JSONObject().put("op", "screen-session").put("device", device).toString(), waitMs);
    }

    /** One command to a screen (built by ScreenCommands): {ok, status, accepted, commandId, code?, error?}. */
    String screenCommand(JSONObject request, long waitMs) throws Exception {
        return port.call(request.toString(), waitMs);
    }

    /** One track's loudness curve and quality: {ok, levels:{samples, quality}} or {ok, none:true}. */
    String trackLevels(String contentId, int samples, long waitMs) throws Exception {
        return port.call(new JSONObject().put("op", "track-levels").put("id", contentId).put("samples", samples).toString(), waitMs);
    }

    /** One track's lyrics: {ok, lyrics:{synced, lines:[{ms,text}]}} or {ok, none:true}. */
    /** "Keep on this phone": the collection a play belongs to, resolved and kept; its tracks to download. */
    String keep(String mediaId, long waitMs) throws Exception {
        return port.call(new JSONObject().put("op", "keep").put("id", mediaId).toString(), waitMs);
    }

    /** keep with a mode: preview (nothing saved), keep, refresh (an existing keep, never revived). */
    String keepMode(String mediaId, String mode, long waitMs) throws Exception {
        return port.call(new JSONObject().put("op", "keep").put("id", mediaId).put("mode", mode).toString(), waitMs);
    }

    /**
     * Kept automatically while listening (spec §3.10): the collection {@code mediaId} belongs
     * to, limited to {@code only} (empty: all of it). Never turns a manual keep automatic.
     */
    String keepAuto(String mediaId, List<String> only, long waitMs) throws Exception {
        return port.call(new JSONObject().put("op", "keep").put("id", mediaId).put("mode", "keep").put("auto", true)
                .put("only", new JSONArray(only)).toString(), waitMs);
    }

    // ── keeping an artist or an author (spec §3.11) ──

    /** What "Keep all…" would keep: {ok, group, units:[{contentId, title, kind, tracks, finished, started, held, overCap}], totalTracks, cap, withinCap}. */
    String groupPreview(String groupId, String kind, long waitMs) throws Exception {
        return port.call(new JSONObject().put("op", "group-preview").put("id", groupId).put("kind", kind == null ? "" : kind).toString(), waitMs);
    }

    /** A following group's new units since it was kept (empty when it does not follow). */
    String groupNew(String groupId, long waitMs) throws Exception {
        return port.call(new JSONObject().put("op", "group-new").put("id", groupId).toString(), waitMs);
    }

    /** The group's record after a choice: {ok, group, orphaned, left, new}. */
    String groupSave(JSONObject group, List<String> chosen, List<String> listed, long waitMs) throws Exception {
        return port.call(new JSONObject().put("op", "group-save").put("group", group).put("chosen", new JSONArray(chosen))
                .put("listed", new JSONArray(listed)).toString(), waitMs);
    }

    /** "Remove all of <name>": {ok, orphaned, units}. */
    String groupRemove(String groupId, long waitMs) throws Exception {
        return port.call(new JSONObject().put("op", "group-remove").put("id", groupId).toString(), waitMs);
    }

    /** One unit kept in a group. */
    String keepUnit(String unitId, String groupId, long waitMs) throws Exception {
        return port.call(new JSONObject().put("op", "keep").put("id", "c:" + unitId).put("mode", "keep").put("group", groupId).toString(), waitMs);
    }

    /** A unit leaves its group: {ok, orphaned, stays}. */
    String unkeepFromGroup(String unitId, long waitMs) throws Exception {
        return port.call(new JSONObject().put("op", "unkeep").put("id", unitId).put("from", "group").toString(), waitMs);
    }

    /** The kept books home says are finished: {ok, finished:[contentId]}. */
    String keptFinished(long waitMs) throws Exception {
        return port.call(new JSONObject().put("op", "kept-finished").toString(), waitMs);
    }

    /** media.downloadCapMb and media.downloadOnCellular, as the payload holds them. */
    String downloadRules(long waitMs) throws Exception {
        return port.call(new JSONObject().put("op", "downloadRules").toString(), waitMs);
    }

    /** The collections kept on this phone, with their tracks. */
    String kept(long waitMs) throws Exception {
        return port.call(new JSONObject().put("op", "kept").toString(), waitMs);
    }

    /** Forget a kept collection; the answer names the tracks no other kept collection holds. */
    String unkeep(String contentId, long waitMs) throws Exception {
        return port.call(new JSONObject().put("op", "unkeep").put("id", contentId).toString(), waitMs);
    }

    /** Puts back kept collections the payload lost (from the shell's mirror): {ok, restored}. */
    String keptRestore(org.json.JSONArray items, long waitMs) throws Exception {
        return keptRestore(items, new JSONArray(), waitMs);
    }

    String keptRestore(org.json.JSONArray items, org.json.JSONArray groups, long waitMs) throws Exception {
        return port.call(new JSONObject().put("op", "kept-restore").put("items", items).put("groups", groups).toString(), waitMs);
    }

    /** The background job's inbox check with the app closed: {ok, status: checked|off|unauthorized|not served|unreachable}. */
    String inboxOnce(long waitMs) throws Exception {
        return port.call(new JSONObject().put("op", "inbox-once").toString(), waitMs);
    }

    /** The whole kept list with each one's state, for the web (through the inbox). */
    String keepsReport(org.json.JSONArray items, long waitMs) throws Exception {
        return port.call(new JSONObject().put("op", "keeps-report").put("items", items).toString(), waitMs);
    }

    String trackLyrics(String contentId, long waitMs) throws Exception {
        return port.call(new JSONObject().put("op", "track-lyrics").put("id", contentId).toString(), waitMs);
    }

    /** One track's chapters: {ok, chapters:{chapters:[{startMs,endMs,title}], durationMs, provider}} or {ok, none:true}. */
    String trackChapters(String contentId, long waitMs) throws Exception {
        return port.call(new JSONObject().put("op", "track-chapters").put("id", contentId).toString(), waitMs);
    }

    /** Waits for a payload to attach. True as soon as one has. */
    boolean awaitReady(long waitMs) {
        return port.awaitReady(waitMs);
    }
}
