package net.kckern.daylight.cap.mediaservice.shell;

import android.net.Uri;
import android.os.Bundle;

import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;

import java.util.ArrayList;
import java.util.List;

/** Parsed answers to Media3 items. No decisions here. */
final class NodeItems {
    static final String ROOT = "root";
    static final String EXTRA_LIST_ID = "listId";

    private NodeItems() { }

    static MediaItem root() {
        return new MediaItem.Builder().setMediaId(ROOT)
                .setMediaMetadata(new MediaMetadata.Builder().setTitle("Daylight").setIsBrowsable(true).setIsPlayable(false).build())
                .build();
    }

    static List<MediaItem> nodes(List<BrowseAnswer.Entry> entries) {
        List<MediaItem> out = new ArrayList<>();
        for (BrowseAnswer.Entry e : entries) {
            MediaMetadata.Builder meta = new MediaMetadata.Builder()
                    .setTitle(e.title)
                    .setIsBrowsable(e.browsable)
                    .setIsPlayable(e.playable);
            if (!e.subtitle.isEmpty()) meta.setSubtitle(e.subtitle).setArtist(e.subtitle);
            if (e.artUrl != null) meta.setArtworkUri(Uri.parse(e.artUrl));
            out.add(new MediaItem.Builder().setMediaId(e.id).setMediaMetadata(meta.build()).build());
        }
        return out;
    }

    static List<MediaItem> tracks(List<TrackAnswer.Track> tracks) {
        List<MediaItem> out = new ArrayList<>();
        for (TrackAnswer.Track t : tracks) {
            Bundle extras = new Bundle();
            extras.putString(EXTRA_LIST_ID, t.listId);
            MediaMetadata.Builder meta = new MediaMetadata.Builder()
                    .setTitle(t.title)
                    .setIsBrowsable(false)
                    .setIsPlayable(true)
                    .setExtras(extras);
            if (!t.artist.isEmpty()) meta.setArtist(t.artist);
            if (!t.album.isEmpty()) meta.setAlbumTitle(t.album);
            if (t.artUrl != null) meta.setArtworkUri(Uri.parse(t.artUrl));
            // The media id is the content id: it is what progress reports are keyed by.
            out.add(new MediaItem.Builder().setMediaId(t.id).setUri(t.url).setMediaMetadata(meta.build()).build());
        }
        return out;
    }
}
