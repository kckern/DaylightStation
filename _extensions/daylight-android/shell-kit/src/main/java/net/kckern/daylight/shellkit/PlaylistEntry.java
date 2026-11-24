package net.kckern.daylight.shellkit;

/** One playlist the picker can offer: its content id, title, (maybe) an https thumbnail and its source. */
public final class PlaylistEntry {
    public final String id;
    public final String title;
    /** An https address, or "" when none is known. */
    public final String art;
    /** The title of the list source it came from, or "" for a remembered playlist not seen in a source. */
    public final String source;

    public PlaylistEntry(String id, String title, String art) {
        this(id, title, art, "");
    }

    public PlaylistEntry(String id, String title, String art, String source) {
        this.id = id == null ? "" : id;
        this.title = title == null ? "" : title;
        this.art = art == null ? "" : art;
        this.source = source == null ? "" : source;
    }
}
