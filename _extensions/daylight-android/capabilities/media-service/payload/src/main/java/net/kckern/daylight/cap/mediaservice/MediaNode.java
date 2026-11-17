package net.kckern.daylight.cap.mediaservice;

import org.json.JSONException;
import org.json.JSONObject;

/** One entry in the browse tree. */
final class MediaNode {
    final String id;
    final String title;
    final String subtitle;
    /** An absolute https URL on the backend, or null. */
    final String artUrl;
    final boolean browsable;
    final boolean playable;

    MediaNode(String id, String title, String subtitle, String artUrl, boolean browsable, boolean playable) {
        this.id = id;
        this.title = title;
        this.subtitle = subtitle;
        this.artUrl = artUrl;
        this.browsable = browsable;
        this.playable = playable;
    }

    /** Fields with no value are left out, so the installed service never sees a JSON null. */
    JSONObject toJson() throws JSONException {
        JSONObject o = new JSONObject().put("id", id).put("title", title).put("browsable", browsable).put("playable", playable);
        if (subtitle != null && !subtitle.isEmpty()) o.put("subtitle", subtitle);
        if (artUrl != null) o.put("artUrl", artUrl);
        return o;
    }
}
