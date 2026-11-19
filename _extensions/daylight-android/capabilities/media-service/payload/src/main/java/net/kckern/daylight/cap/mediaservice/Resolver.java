package net.kckern.daylight.cap.mediaservice;

import net.kckern.daylight.core.backend.Backend;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Turns media ids into tracks. Pure apart from the MediaApi it is given.
 *
 * Nothing plays that the backend did not answer for: an id is asked of the queue or
 * the play route, and a track's stream is the URL in that answer. An id the backend
 * does not know fails here (MediaApi.Refused), and so does one that is not a media id.
 */
final class Resolver {
    /** The most ids one request may name, and the most tracks one request queues. */
    static final int MAX_IDS = 50;
    static final int MAX_TRACKS = 500;

    static final class Resolved {
        final List<Track> tracks;
        final int startIndex;
        final long startPositionMs;
        final boolean selectionResolved;

        Resolved(List<Track> tracks, int startIndex, long startPositionMs, boolean selectionResolved) {
            this.tracks = tracks;
            this.startIndex = startIndex;
            this.startPositionMs = startPositionMs;
            this.selectionResolved = selectionResolved;
        }
    }

    private Resolver() { }

    static Resolved resolve(List<String> mediaIds, MediaApi api, Backend backend, String session) throws Exception {
        return resolve(mediaIds, -1, api, backend, session);
    }

    static Resolved resolve(List<String> mediaIds, int requestedIndex, MediaApi api, Backend backend, String session) throws Exception {
        if (mediaIds == null || mediaIds.isEmpty()) throw new IllegalArgumentException("unknown media id");
        if (mediaIds.size() > MAX_IDS) throw new IllegalArgumentException("too many media ids");
        List<MediaId> ids = new ArrayList<>();
        for (String raw : mediaIds) {
            MediaId id = MediaId.parse(raw);
            if (id.kind != MediaId.Kind.CONTAINER && id.kind != MediaId.Kind.LEAF) throw new IllegalArgumentException("unknown media id");
            ids.add(id);
        }
        List<Track> tracks = new ArrayList<>();
        int startIndex = 0;
        long startPositionMs = 0;
        boolean single = ids.size() == 1;
        // Each input can add zero, one, or several tracks. Record its queue range.
        int[] offsets = new int[ids.size() + 1];
        for (int i = 0; i < ids.size(); i++) {
            offsets[i] = tracks.size();
            MediaId id = ids.get(i);
            if (id.kind == MediaId.Kind.CONTAINER) {
                tracks.addAll(QueueMapper.fromQueue(api.queue(id.contentId), backend, session));
                continue;
            }
            // A leaf asked for by itself, with a known container: queue the container and
            // start at the leaf, so an album keeps playing.
            if (single && id.parent != null) {
                JSONObject queue = api.queue(id.parent);
                List<Track> siblings = QueueMapper.fromQueue(queue, backend, session);
                int at = -1;
                for (int sibling = 0; sibling < siblings.size(); sibling++) {
                    if (siblings.get(sibling).id.equals(id.contentId)) at = sibling;
                }
                if (at >= 0) {
                    tracks.addAll(siblings);
                    startIndex = at;
                    startPositionMs = QueueMapper.resumeMs(itemOf(queue, id.contentId));
                    continue;
                }
            }
            JSONObject play = api.play(id.contentId);
            // The play route answers a container with its first playable item. The id in
            // the answer is then not the one asked for, and the whole container is queued.
            String answered = QueueMapper.id(play);
            if (!answered.isEmpty() && !answered.equals(id.contentId)) {
                tracks.addAll(QueueMapper.fromQueue(api.queue(id.contentId), backend, session));
                continue;
            }
            Track t = QueueMapper.fromItem(play, backend, session);
            if (t != null) {
                tracks.add(t);
                if (single) startPositionMs = QueueMapper.resumeMs(play);
            }
        }
        offsets[ids.size()] = tracks.size();
        boolean selectionResolved = requestedIndex >= 0 && requestedIndex < ids.size()
                && offsets[requestedIndex] < offsets[requestedIndex + 1];
        if (!single && selectionResolved) {
            startIndex = offsets[requestedIndex];
        }
        if (tracks.isEmpty()) throw new IllegalArgumentException("nothing here plays as audio");
        if (tracks.size() > MAX_TRACKS) {
            // Keep the item that was asked for inside what is kept.
            int from = Math.min(startIndex, tracks.size() - MAX_TRACKS);
            tracks = new ArrayList<>(tracks.subList(from, from + MAX_TRACKS));
            startIndex -= from;
        }
        return new Resolved(tracks, startIndex, startPositionMs, selectionResolved);
    }

    private static JSONObject itemOf(JSONObject queue, String contentId) {
        JSONArray items = queue.optJSONArray("items");
        for (int i = 0; items != null && i < items.length(); i++) {
            JSONObject item = items.optJSONObject(i);
            if (item != null && contentId.equals(QueueMapper.id(item))) return item;
        }
        return null;
    }
}
