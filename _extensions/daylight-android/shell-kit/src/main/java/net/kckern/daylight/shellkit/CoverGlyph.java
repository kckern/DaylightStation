package net.kckern.daylight.shellkit;

import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.InsetDrawable;
import android.graphics.drawable.LayerDrawable;
import android.widget.ImageView;

/**
 * A missing or loading cover is a tinted glyph of its kind on the tile colour, never a flat
 * dark square (design sweep rule 7, D5): a book, an album, a playlist, a person, a track.
 * Set as the ImageView's background, so the cover draws over it when it comes.
 */
public final class CoverGlyph {
    public enum Kind { BOOK, ALBUM, PLAYLIST, PERSON, TRACK, DEVICE }

    private CoverGlyph() { }

    /** The kind for home's words ("book", "author", "album", "playlist"…); album when unknown. */
    public static Kind of(String kind) {
        if (kind == null) return Kind.ALBUM;
        switch (kind) {
            case "book": case "books": case "part": case "series": case "lecture": case "talks": case "library-books": case "library-talks":
                return Kind.BOOK;
            case "author": case "artist": case "speaker": case "artists":
                return Kind.PERSON;
            case "playlist": case "playlists": case "station": case "lists":
                return Kind.PLAYLIST;
            case "track":
                return Kind.TRACK;
            default:
                return Kind.ALBUM;
        }
    }

    public static int icon(Kind k) {
        switch (k) {
            case BOOK: return R.drawable.daylight_ic_book;
            case PERSON: return R.drawable.daylight_ic_person;
            case PLAYLIST: return R.drawable.daylight_ic_playlist;
            case TRACK: return R.drawable.daylight_ic_music;
            case DEVICE: return R.drawable.daylight_ic_tv;
            default: return R.drawable.daylight_ic_album;
        }
    }

    /** The placeholder: the tile, rounded {@code radiusPx}, with the kind's glyph at a third of {@code sidePx}. */
    public static Drawable placeholder(Context c, DaylightTheme t, Kind kind, int sidePx, float radiusPx) {
        Drawable tile = DaylightTheme.round(t.tile, radiusPx);
        Drawable glyph = c.getDrawable(icon(kind)).mutate();
        glyph.setTintList(ColorStateList.valueOf(DaylightTheme.withAlpha(t.inkMuted, 0x99)));
        int inset = Math.max(0, sidePx / 3);
        return new LayerDrawable(new Drawable[] { tile, new InsetDrawable(glyph, inset) });
    }

    /** Puts the placeholder behind {@code cover} (clipped to its outline). */
    public static void behind(ImageView cover, DaylightTheme t, Kind kind, int sidePx, float radiusPx) {
        cover.setBackground(placeholder(cover.getContext(), t, kind, sidePx, radiusPx));
        cover.setClipToOutline(true);
    }
}
