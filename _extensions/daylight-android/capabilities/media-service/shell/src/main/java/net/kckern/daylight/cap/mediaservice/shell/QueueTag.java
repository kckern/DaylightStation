package net.kckern.daylight.cap.mediaservice.shell;

import android.os.Bundle;

import androidx.media3.common.MediaItem;

import java.util.List;

/**
 * What a play request says about the source it starts (the queue's "Next from …"): its
 * label, the id that was asked for and whether home shuffled it. Carried on the start
 * item's local tag from LibraryCallback to the session player, in this process only.
 */
final class QueueTag {
    /** A request extra this app's screens set: the source's name ("Snakes & Arrows", "search: snakes"). */
    static final String EXTRA_LABEL = "daylight.queue.label";

    final String label;
    final String sourceId;
    final boolean shuffled;

    QueueTag(String label, String sourceId, boolean shuffled) {
        this.label = label == null ? "" : label;
        this.sourceId = sourceId == null ? "" : sourceId;
        this.shuffled = shuffled;
    }

    /** The label a request names, or null. */
    static String labelOf(List<MediaItem> requested) {
        if (requested == null || requested.isEmpty()) return null;
        MediaItem.RequestMetadata m = requested.get(0).requestMetadata;
        Bundle extras = m == null ? null : m.extras;
        String l = extras == null ? null : extras.getString(EXTRA_LABEL);
        return l == null || l.isEmpty() ? null : l;
    }

    /**
     * The resolved items with the start item tagged. Without a named label, the start
     * track's album (else its title) names the source.
     */
    static List<MediaItem> tag(List<MediaItem> items, int start, List<MediaItem> requested, boolean shuffled) {
        if (items == null || items.isEmpty()) return items;
        int s = Math.max(0, Math.min(start, items.size() - 1));
        MediaItem first = items.get(s);
        if (first.localConfiguration == null || first.localConfiguration.tag != null) return items;
        String label = labelOf(requested);
        if (label == null) label = defaultLabel(first);
        String asked = requested == null || requested.isEmpty() ? "" : requested.get(0).mediaId;
        items.set(s, first.buildUpon().setTag(new QueueTag(label, asked, shuffled)).build());
        return items;
    }

    /** The id asked for, from the tagged start item; "" when it carries no tag. */
    static String askedOf(List<MediaItem> items, int start) {
        if (items == null || items.isEmpty()) return "";
        MediaItem first = items.get(Math.max(0, Math.min(start, items.size() - 1)));
        Object tag = first.localConfiguration == null ? null : first.localConfiguration.tag;
        return tag instanceof QueueTag ? ((QueueTag) tag).sourceId : "";
    }

    static String defaultLabel(MediaItem item) {
        CharSequence album = item.mediaMetadata.albumTitle;
        if (album != null && album.length() > 0) return album.toString();
        CharSequence title = item.mediaMetadata.title;
        return title == null ? "" : title.toString();
    }

    /** A request (Play, Shuffle, a tap) with the source's name. */
    static MediaItem request(MediaItem base, String label) {
        if (label == null || label.isEmpty()) return base;
        MediaItem.RequestMetadata m = base.requestMetadata;
        Bundle extras = m == null || m.extras == null ? new Bundle() : new Bundle(m.extras);
        extras.putString(EXTRA_LABEL, label);
        return base.buildUpon().setRequestMetadata(new MediaItem.RequestMetadata.Builder()
                .setMediaUri(m == null ? null : m.mediaUri)
                .setSearchQuery(m == null ? null : m.searchQuery)
                .setExtras(extras).build()).build();
    }
}
