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
    /** Set on a book's part, a talk or a lecture (TrackAnswer.Track.longForm). */
    static final String EXTRA_LONG_FORM = "longForm";

    private NodeItems() { }

    static MediaItem root() {
        return new MediaItem.Builder().setMediaId(ROOT)
                .setMediaMetadata(new MediaMetadata.Builder().setTitle("Daylight").setIsBrowsable(true).setIsPlayable(false).build())
                .build();
    }

    static MediaItem drivingRadio(String today) {
        return drivingRadio(today, "");
    }

    static MediaItem drivingRadio(String today, String art) {
        // The station is what you are choosing, so it leads; the second line says what the tile is.
        String name = today == null || today.isEmpty() ? "Driving Radio" : today;
        MediaMetadata.Builder meta = new MediaMetadata.Builder().setTitle(name)
                .setSubtitle("Driving Radio").setArtist("Driving Radio").setIsBrowsable(false).setIsPlayable(true);
        if (art != null && art.startsWith("https://")) meta.setArtworkUri(Uri.parse(art));
        return new MediaItem.Builder().setMediaId(net.kckern.daylight.shellkit.DrivingRadioSettings.MEDIA_ID)
                .setMediaMetadata(meta.build()).build();
    }

    static MediaItem named(String id, String title, boolean folder) {
        return named(id, title, folder, "");
    }

    /** A named node with a thumbnail (an https address) when one is known. */
    static MediaItem named(String id, String title, boolean folder, String art) {
        return named(id, title, folder, art, "");
    }

    /** A named node with a thumbnail and a second line (a car draws the display subtitle). */
    static MediaItem named(String id, String title, boolean folder, String art, String subtitle) {
        MediaMetadata.Builder meta = new MediaMetadata.Builder().setTitle(title)
                .setIsBrowsable(folder).setIsPlayable(!folder);
        if (subtitle != null && !subtitle.isEmpty()) meta.setSubtitle(subtitle).setArtist(subtitle);
        if (art != null && art.startsWith("https://")) meta.setArtworkUri(Uri.parse(art));
        return new MediaItem.Builder().setMediaId(id).setMediaMetadata(meta.build()).build();
    }

    // Android Auto's content-style hints (androidx.media.utils.MediaConstants). A browsable
    // item's hints say how its children are drawn: 1 is a list, 2 is a grid of tiles.
    static final String STYLE_SUPPORTED = "android.media.browse.CONTENT_STYLE_SUPPORTED";
    private static final String STYLE_PLAYABLE = "android.media.browse.CONTENT_STYLE_PLAYABLE_HINT";
    private static final String STYLE_BROWSABLE = "android.media.browse.CONTENT_STYLE_BROWSABLE_HINT";
    private static final int STYLE_GRID = 2;

    private static Bundle gridChildren() {
        Bundle extras = new Bundle();
        extras.putInt(STYLE_PLAYABLE, STYLE_GRID);
        extras.putInt(STYLE_BROWSABLE, STYLE_GRID);
        return extras;
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
            // The Drive tab's staged playlists read as a grid of thumbnails, not a text list.
            if (DrivingRadio.DRIVE.equals(e.id)) meta.setExtras(gridChildren());
            out.add(new MediaItem.Builder().setMediaId(e.id).setMediaMetadata(meta.build()).build());
        }
        return out;
    }

    /** A finite original can supply duration even if the encoded stream has no index. */
    /** Whether the payload called this item long-form by its kind (a book's part, a talk, a lecture). */
    static boolean longFormKind(MediaItem item) {
        return item != null && item.mediaMetadata.extras != null && item.mediaMetadata.extras.getBoolean(EXTRA_LONG_FORM, false);
    }

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
            if (t.longForm) extras.putBoolean(EXTRA_LONG_FORM, true);
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
            // The cache key is the content id, not the URL (whose session may differ): a track
            // kept on this phone is found in the download cache however it was resolved.
            out.add(new MediaItem.Builder().setMediaId(t.id).setUri(t.url).setCustomCacheKey(KeepStore.playKey(t.id))
                    .setMediaMetadata(meta.build()).build());
        }
        return out;
    }
}
