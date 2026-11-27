package net.kckern.daylight.cap.mediaservice.shell;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/**
 * What Keep offers for an item (2026-11-27: the owner wanted one music track and Keep kept
 * its whole two-track album). A music track: "Keep this track", then "Keep the album". A
 * book, a talk or a course: the whole of it, always (a part alone is no use offline). An
 * album or a playlist from its page: the album or list. On mobile data with downloads held
 * to Wi-Fi, the keep sheet also offers "Download now on mobile data (this time)". Pure.
 */
final class KeepChoices {
    private KeepChoices() { }

    static final String TRACK = "track", ALBUM = "album", BOOK = "book", LIST = "list";

    /**
     * @param kind    the item's kind (MediaKind words: "music"/"track", "book", "album", "playlist", …)
     * @param isTrack the item is one track or part (a row, Now playing's item), not a page's whole
     */
    static List<String> of(String kind, boolean isTrack) {
        String k = MediaKind.normal(kind);
        if (MediaKind.spoken(kind) || "book".equals(k) || "part".equals(k)) return Collections.singletonList(BOOK);
        if ("playlist".equals(k)) return Collections.singletonList(LIST);
        if (isTrack) return Arrays.asList(TRACK, ALBUM);
        return Collections.singletonList(ALBUM);
    }

    /** The row's words for a choice. */
    static String words(String choice) {
        switch (choice) {
            case TRACK: return "Keep this track";
            case BOOK: return "Keep the book";
            case LIST: return "Keep the playlist";
            default: return "Keep the album";
        }
    }

    /** The sheet offers "Download now on mobile data (this time)": on mobile data, with keeps held to Wi-Fi. */
    static boolean offerMobileOnce(boolean onMobile, boolean mobileAllowed) {
        return onMobile && !mobileAllowed;
    }

    /** A sheet is needed: more than one thing to keep, or the mobile-data choice to make. */
    static boolean asks(List<String> choices, boolean mobileOnce) {
        return choices.size() > 1 || mobileOnce;
    }

    /** The suffix that marks a keep of one track, so it never shares a keep attempt with its album's. */
    private static final String ONE = "#track";

    /** The keep id for "Keep this track" of {@code mediaId} ("p:plex:20|plex:9"). */
    static String trackKeepId(String mediaId) { return mediaId == null ? "" : mediaId.endsWith(ONE) ? mediaId : mediaId + ONE; }

    /** The id the payload is asked with: the keep id without the one-track mark. */
    static String baseId(String keepId) {
        return keepId != null && keepId.endsWith(ONE) ? keepId.substring(0, keepId.length() - ONE.length()) : keepId;
    }

    /** The payload's {@code only} for a keep id: the one track's content id, or empty for the whole. */
    static List<String> onlyOf(String keepId) {
        if (keepId == null || !keepId.endsWith(ONE)) return Collections.emptyList();
        String base = baseId(keepId);
        String id = base.length() > 2 && base.charAt(1) == ':' ? base.substring(2) : base;
        int bar = id.indexOf('|');
        if (bar >= 0) id = id.substring(0, bar);
        return id.isEmpty() ? Collections.emptyList() : Collections.singletonList(id);
    }
}
