package net.kckern.daylight.cap.mediaservice.shell;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * The payload's answer to a resolve request: the tracks to queue and where to start.
 * Pure. A track's stream is a web URL the payload gave (it takes it from the backend's
 * answer, on the backend's origin); one that is anything else is left out.
 */
final class TrackAnswer {
    static final int MAX_TRACKS = 1000;

    static final class Track {
        final String id;
        final String url;
        final String title;
        final String artist;
        final String album;
        /** An https URL, or null. */
        final String artUrl;
        final String listId;

        Track(String id, String url, String title, String artist, String album, String artUrl, String listId) {
            this.id = id;
            this.url = url;
            this.title = title;
            this.artist = artist;
            this.album = album;
            this.artUrl = artUrl;
            this.listId = listId;
        }
    }

    final List<Track> tracks;
    final int startIndex;
    final long startPositionMs;
    final boolean selectionResolved;

    private TrackAnswer(List<Track> tracks, int startIndex, long startPositionMs, boolean selectionResolved) {
        this.tracks = tracks;
        this.startIndex = startIndex;
        this.startPositionMs = startPositionMs;
        this.selectionResolved = selectionResolved;
    }

    static TrackAnswer parse(String json) throws BrowseAnswer.Failed {
        JSONObject o = BrowseAnswer.accepted(json);
        JSONArray list = o.optJSONArray("tracks");
        List<Track> out = new ArrayList<>();
        int start = o.optInt("startIndex", 0);
        int keptStart = -1;
        for (int i = 0; list != null && i < list.length() && out.size() < MAX_TRACKS; i++) {
            JSONObject t = list.optJSONObject(i);
            if (t == null) continue;
            String id = t.optString("id", "");
            String url = t.optString("url", "");
            if (id.isEmpty() || !(url.startsWith("https://") || url.startsWith("http://"))) continue;
            if (i == start) keptStart = out.size();
            out.add(new Track(id, url, t.optString("title", ""), t.optString("artist", ""), t.optString("album", ""),
                    BrowseAnswer.https(t.optString("artUrl", "")), t.optString("listId", "")));
        }
        if (out.isEmpty()) throw new BrowseAnswer.Failed("nothing to play");
        return new TrackAnswer(out, Math.max(0, keptStart), Math.max(0, o.optLong("startPositionMs", 0)),
                keptStart >= 0 && o.optBoolean("selectionResolved"));
    }
}
