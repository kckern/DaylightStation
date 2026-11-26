package net.kckern.daylight.cap.mediaservice;

import org.json.JSONException;
import org.json.JSONObject;

/** One playable audio item with an absolute stream URL on the backend. */
final class Track {
    final String id;
    final String url;
    final String title;
    final String artist;
    final String album;
    final String artUrl;
    final String listId;
    final long durationMs;
    /** The file behind it at home ("<partId>:<updatedAt>"), when the backend says; "" otherwise. */
    final String fileVersion;

    Track(String id, String url, String title, String artist, String album, String artUrl, String listId, long durationMs) {
        this(id, url, title, artist, album, artUrl, listId, durationMs, "");
    }

    Track(String id, String url, String title, String artist, String album, String artUrl, String listId, long durationMs,
          String fileVersion) {
        this.id = id;
        this.url = url;
        this.title = title;
        this.artist = artist;
        this.album = album;
        this.artUrl = artUrl;
        this.listId = listId;
        this.durationMs = durationMs;
        this.fileVersion = fileVersion == null ? "" : fileVersion;
    }

    JSONObject toJson() throws JSONException {
        JSONObject o = new JSONObject().put("id", id).put("url", url).put("title", title).put("durationMs", durationMs);
        if (!artist.isEmpty()) o.put("artist", artist);
        if (!album.isEmpty()) o.put("album", album);
        if (artUrl != null) o.put("artUrl", artUrl);
        if (!listId.isEmpty()) o.put("listId", listId);
        if (!fileVersion.isEmpty()) o.put("fileVersion", fileVersion);
        return o;
    }
}
