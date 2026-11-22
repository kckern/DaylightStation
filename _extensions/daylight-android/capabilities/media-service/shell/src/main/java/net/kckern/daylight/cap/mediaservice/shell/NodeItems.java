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
    private static final String EXTRA_DURATION_MS = "durationMs";

    private NodeItems() { }

    static MediaItem root() {
        return new MediaItem.Builder().setMediaId(ROOT)
                .setMediaMetadata(new MediaMetadata.Builder().setTitle("Daylight").setIsBrowsable(true).setIsPlayable(false).build())
                .build();
    }

    static MediaItem drivingRadio(String today) {
        return new MediaItem.Builder().setMediaId(net.kckern.daylight.shellkit.DrivingRadioSettings.MEDIA_ID)
                .setMediaMetadata(new MediaMetadata.Builder().setTitle("Driving Radio")
                        .setSubtitle(today).setArtist(today).setIsBrowsable(false).setIsPlayable(true).build())
                .build();
    }

    static MediaItem named(String id, String title, boolean folder) {
        return new MediaItem.Builder().setMediaId(id)
                .setMediaMetadata(new MediaMetadata.Builder().setTitle(title)
                        .setIsBrowsable(folder).setIsPlayable(!folder).build()).build();
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

    /** A finite original can supply duration even if the encoded stream has no index. */
    static String listId(MediaItem item) {
        if (item == null || item.mediaMetadata.extras == null) return "";
        String id = item.mediaMetadata.extras.getString(EXTRA_LIST_ID);
        return id == null ? "" : id;
    }

    static long durationMs(MediaItem item, long playerDurationMs) {
        if (playerDurationMs > 0 || item == null || item.mediaMetadata.extras == null) return playerDurationMs;
        long declared = item.mediaMetadata.extras.getLong(EXTRA_DURATION_MS, 0);
        return declared > 0 ? declared : playerDurationMs;
    }

    static List<MediaItem> tracks(List<TrackAnswer.Track> tracks) {
        List<MediaItem> out = new ArrayList<>();
        for (TrackAnswer.Track t : tracks) {
            Bundle extras = new Bundle();
            extras.putString(EXTRA_LIST_ID, t.listId);
            if (t.durationMs > 0) extras.putLong(EXTRA_DURATION_MS, t.durationMs);
            MediaMetadata.Builder meta = new MediaMetadata.Builder()
                    .setTitle(t.title)
                    .setIsBrowsable(false)
                    .setIsPlayable(true)
                    .setExtras(extras);
            // A car's now-playing card shows the display subtitle, not the artist field:
            // set both, as the browse rows do. The album is the description line.
            if (!t.artist.isEmpty()) meta.setArtist(t.artist).setSubtitle(t.artist);
            else if (!t.album.isEmpty()) meta.setSubtitle(t.album);
            if (!t.album.isEmpty()) meta.setAlbumTitle(t.album).setDescription(t.album);
            if (t.artUrl != null) meta.setArtworkUri(Uri.parse(t.artUrl));
            // The media id is the content id: it is what progress reports are keyed by.
            out.add(new MediaItem.Builder().setMediaId(t.id).setUri(t.url).setMediaMetadata(meta.build()).build());
        }
        return out;
    }
}
