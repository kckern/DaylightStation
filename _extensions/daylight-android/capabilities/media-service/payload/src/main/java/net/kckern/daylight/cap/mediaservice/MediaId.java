package net.kckern.daylight.cap.mediaservice;

/**
 * The ids of the browse tree, the only thing the installed media service hands back.
 * Pure.
 *
 *   root                        the tabs (media.roots)
 *   recent | catalog            the two fixed tabs
 *   c:<contentId>               a container, from its first child
 *   m:<skip>|<contentId>        the same container from child number <skip> ("More")
 *   p:<contentId>               a playable item with no known container
 *   p:<contentId>|<parentId>    a playable item inside a container
 *
 * Anything else is refused with one fixed message. In particular an id is never a
 * URL: what plays is whatever the backend answers for a content id.
 */
final class MediaId {
    enum Kind { ROOT, RECENT, CONTINUE, CATALOG, CONTAINER, AUDIO_SOURCE, AUDIO_LIST, LEAF }

    static final String ROOT = "root";
    static final String RECENT = "recent";
    /** Long items in progress, then the lists played lately: the car's Continue tab. */
    static final String CONTINUE = "continue";
    static final String CATALOG = "catalog";
    /** The most children of one container that can be reached by paging. */
    static final int MAX_SKIP = 100_000;

    final Kind kind;
    /** Null for the fixed nodes. */
    final String contentId;
    /** A leaf's container, or null. */
    final String parent;
    /** A container's first child. */
    final int skip;

    private MediaId(Kind kind, String contentId, String parent, int skip) {
        this.kind = kind;
        this.contentId = contentId;
        this.parent = parent;
        this.skip = skip;
    }

    static String container(String contentId) { return "c:" + contentId; }

    static String audioSource(String contentId, int skip) { return "s:" + skip + "|" + contentId; }

    static String audioList(String contentId, int skip) { return "a:" + skip + "|" + contentId; }

    static String more(String contentId, int skip) { return "m:" + skip + "|" + contentId; }

    static String leaf(String contentId, String parent) { return "p:" + contentId + (parent == null ? "" : "|" + parent); }

    static MediaId parse(String raw) {
        if (raw == null) throw unknown();
        if (ROOT.equals(raw)) return new MediaId(Kind.ROOT, null, null, 0);
        if (RECENT.equals(raw)) return new MediaId(Kind.RECENT, null, null, 0);
        if (CONTINUE.equals(raw)) return new MediaId(Kind.CONTINUE, null, null, 0);
        if (CATALOG.equals(raw)) return new MediaId(Kind.CATALOG, null, null, 0);
        if (raw.length() > 2 * ContentId.MAX_LENGTH + 16 || raw.length() < 3 || raw.charAt(1) != ':') throw unknown();
        String rest = raw.substring(2);
        int bar = rest.indexOf('|');
        switch (raw.charAt(0)) {
            case 'c':
                if (!ContentId.valid(rest)) throw unknown();
                return new MediaId(Kind.CONTAINER, rest, null, 0);
            case 'a':
            case 's':
            case 'm': {
                if (bar <= 0) throw unknown();
                String digits = rest.substring(0, bar);
                String contentId = rest.substring(bar + 1);
                if (digits.length() > 6 || !ContentId.valid(contentId)) throw unknown();
                int skip;
                try { skip = Integer.parseInt(digits); } catch (NumberFormatException e) { throw unknown(); }
                if (skip < 0 || skip > MAX_SKIP || !digits.equals(String.valueOf(skip))) throw unknown();
                Kind kind = raw.charAt(0) == 'a' ? Kind.AUDIO_LIST
                        : raw.charAt(0) == 's' ? Kind.AUDIO_SOURCE : Kind.CONTAINER;
                return new MediaId(kind, contentId, null, skip);
            }
            case 'p': {
                String contentId = bar < 0 ? rest : rest.substring(0, bar);
                String parent = bar < 0 ? null : rest.substring(bar + 1);
                if (!ContentId.valid(contentId) || (parent != null && !ContentId.valid(parent))) throw unknown();
                return new MediaId(Kind.LEAF, contentId, parent, 0);
            }
            default:
                throw unknown();
        }
    }

    /** One fixed message: an id can be a stranger's text and is never repeated. */
    private static IllegalArgumentException unknown() { return new IllegalArgumentException("unknown media id"); }
}
