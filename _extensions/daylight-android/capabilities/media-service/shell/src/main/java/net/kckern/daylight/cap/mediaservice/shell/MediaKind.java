package net.kckern.daylight.cap.mediaservice.shell;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/**
 * Every page action, row tap, row menu and Now playing control by the item's kind
 * (ops:docs/superpowers/specs/2026-11-26-phone-lookup-and-browse.md §8). The kind is
 * home's (the payload tags each entry from home's library kinds): album, playlist, station,
 * artist (music); author, book, part (books); speaker, series, lecture (talks and courses).
 *
 * <p>A detail page's actions are an {@link ActionSet}: one primary action (a filled
 * circular button at the header's edge), at most four secondary icon buttons under the
 * header, and the rarer ones in a ⋮ overflow. No pills. Pure.
 */
final class MediaKind {
    private MediaKind() { }

    enum Action {
        PLAY, RESUME, CONTINUE, SHUFFLE_ARTIST,
        SHUFFLE, PLAY_ON, KEEP, SPEED, CHAPTERS,
        PLAY_FROM_START, MARK_FINISHED, ADD_TO_PLAYLISTS
    }

    enum Tap { PLAY_FROM_HERE, OPEN, NONE }

    enum RowAction { PLAY_NEXT, ADD_TO_QUEUE, GO_TO_ALBUM, GO_TO_ARTIST, KEEP_TRACK, KEEP_ALBUM, PLAY_FROM_HERE, MARK_FINISHED_UP_TO_HERE, MARK_WATCHED, MARK_UNWATCHED }

    static final int MAX_SECONDARY = 4;

    /** A page's actions: the primary (null for none), the icon row, the overflow. */
    static final class ActionSet {
        final Action primary;
        final List<Action> secondary, overflow;
        ActionSet(Action primary, List<Action> secondary, List<Action> overflow) {
            if (secondary.size() > MAX_SECONDARY) throw new IllegalArgumentException("at most " + MAX_SECONDARY + " secondary actions");
            this.primary = primary;
            this.secondary = Collections.unmodifiableList(secondary);
            this.overflow = Collections.unmodifiableList(overflow);
        }
        boolean has(Action a) { return primary == a || secondary.contains(a) || overflow.contains(a); }
    }

    private static final ActionSet NONE = new ActionSet(null, Collections.emptyList(), Collections.emptyList());

    /** The older words a link or a cached row may still carry ("books", "albums"…), as kinds. */
    static String normal(String kind) {
        if (kind == null) return "";
        switch (kind) {
            case "books": return "book";
            case "albums": case "kept": case "tracks": case "collection": return "album";
            case "artists": return "artist";
            case "playlists": return "playlist";
            case "talks": return "series";
            default: return kind;
        }
    }

    /**
     * A detail page's actions. {@code started}: an author with a book started (Continue
     * <book>), or a book with a place in it (Resume rather than Play).
     */
    static ActionSet actions(String kind, boolean started) {
        switch (normal(kind)) {
            case "album": case "playlist":
                return new ActionSet(Action.PLAY, Arrays.asList(Action.SHUFFLE, Action.PLAY_ON, Action.KEEP),
                        Collections.singletonList(Action.ADD_TO_PLAYLISTS));
            case "station":
                return new ActionSet(Action.PLAY, Arrays.asList(Action.PLAY_ON, Action.KEEP), Collections.emptyList());
            case "artist":
                return new ActionSet(Action.SHUFFLE_ARTIST, Collections.emptyList(), Collections.emptyList());
            case "author": case "speaker":
                return started ? new ActionSet(Action.CONTINUE, Collections.emptyList(), Collections.emptyList()) : NONE;
            case "book":
                return new ActionSet(started ? Action.RESUME : Action.PLAY,
                        Arrays.asList(Action.PLAY_ON, Action.KEEP, Action.SPEED, Action.CHAPTERS),
                        started ? Arrays.asList(Action.PLAY_FROM_START, Action.MARK_FINISHED) : Collections.singletonList(Action.MARK_FINISHED));
            case "series":
                return new ActionSet(Action.RESUME, Arrays.asList(Action.PLAY_ON, Action.KEEP), Collections.emptyList());
            default:
                return NONE;
        }
    }

    /** Whether a level of this kind is a detail page (a header about one thing), not a list. */
    static boolean detail(String kind) {
        switch (normal(kind)) {
            case "album": case "playlist": case "station": case "artist": case "author": case "speaker": case "book": case "series":
                return true;
            default:
                return false;
        }
    }

    /** A page about a person (portrait, facts, summary), not a collection. */
    static boolean aboutPerson(String kind) {
        String k = normal(kind);
        return k.equals("artist") || k.equals("author") || k.equals("speaker");
    }

    /** An author or a speaker: their books' lengths and progress are asked with the header. */
    static boolean hasBooks(String kind) {
        String k = normal(kind);
        return k.equals("author") || k.equals("speaker");
    }

    /** Spoken word: a book, a talk, a course, and the people and libraries of them. */
    static boolean spoken(String kind) {
        switch (normal(kind)) {
            case "book": case "part": case "author": case "series": case "speaker": case "lecture":
            case "library-books": case "library-talks":
                return true;
            default:
                return false;
        }
    }

    /** Whether a station's page lists its tracks: it does not (they are sequenced at home). */
    static boolean listsRows(String kind) { return !"station".equals(normal(kind)); }

    /** A row's tap on a page of {@code pageKind}. */
    static Tap rowTap(String pageKind, boolean rowBrowsable, boolean rowPlayable) {
        if (!listsRows(pageKind)) return Tap.NONE;
        if (rowBrowsable) return Tap.OPEN;
        return rowPlayable ? Tap.PLAY_FROM_HERE : Tap.NONE;
    }

    /** A playable row's ⋮ menu on a page of {@code pageKind} (empty: no ⋮). */
    static List<RowAction> rowMenu(String pageKind) {
        switch (normal(pageKind)) {
            case "album": case "playlist":
                return Arrays.asList(RowAction.PLAY_NEXT, RowAction.ADD_TO_QUEUE, RowAction.GO_TO_ALBUM, RowAction.GO_TO_ARTIST,
                        RowAction.KEEP_TRACK, RowAction.KEEP_ALBUM);
            case "book":
                return Arrays.asList(RowAction.PLAY_FROM_HERE, RowAction.MARK_FINISHED_UP_TO_HERE);
            case "series":
                return Arrays.asList(RowAction.MARK_WATCHED, RowAction.MARK_UNWATCHED);
            default:
                return Collections.emptyList();
        }
    }

    /** A search row's ⋮: music tracks get the music menu; a book part or a lecture none (never Play next). */
    static List<RowAction> searchRowMenu(String rowKind) {
        return "track".equals(normal(rowKind)) ? Arrays.asList(RowAction.PLAY_NEXT, RowAction.ADD_TO_QUEUE, RowAction.GO_TO_ALBUM, RowAction.GO_TO_ARTIST,
                RowAction.KEEP_TRACK, RowAction.KEEP_ALBUM)
                : Collections.emptyList();
    }

    /** Now playing's controls: music has shuffle, repeat, lyrics and crossfade; spoken word has speed, chapters and ±30 s instead. */
    static final class Controls {
        final boolean shuffle, repeat, lyrics, crossfade, speed, jumps;
        Controls(boolean spoken) {
            shuffle = !spoken;
            repeat = !spoken;
            lyrics = !spoken;
            crossfade = !spoken;
            speed = spoken;
            jumps = spoken;
        }
    }

    static Controls controls(boolean spoken) { return new Controls(spoken); }

    /** What a row opened from a level is: a library's authors or artists, their books or albums, a list source's playlists. */
    static String childKind(String parentKind, String id) {
        // A list source's entries are playlists (reached as a:<skip>|<id>); a source is a list of lists.
        if (id.startsWith("s:")) return "lists";
        if ("lists".equals(parentKind)) return "playlist";
        if (id.startsWith("a:")) return "lists";
        switch (normal(parentKind)) {
            case "library-books": return "author";
            case "library-talks": return "speaker";
            case "library": return "artist";
            case "author": return "book";
            case "speaker": return "series";
            case "artist": return "album";
            default: return "album";
        }
    }

    /** "First book" / "Last book" at a swipe's edge, by the kind being paged. */
    static String edgeWord(String kind, boolean first) {
        String what;
        switch (normal(kind)) {
            case "author": what = "author"; break;
            case "speaker": what = "speaker"; break;
            case "book": what = "book"; break;
            case "series": what = "course"; break;
            case "artist": what = "artist"; break;
            case "playlist": case "station": what = "playlist"; break;
            default: what = "album";
        }
        return (first ? "First " : "Last ") + what;
    }
}
