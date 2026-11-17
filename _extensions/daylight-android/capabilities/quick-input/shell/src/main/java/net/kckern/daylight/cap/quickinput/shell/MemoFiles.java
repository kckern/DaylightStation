package net.kckern.daylight.cap.quickinput.shell;

import java.io.File;
import java.util.Locale;

/**
 * Where a recording goes and what it is called. No Android types.
 *
 * Contract with the payload's quick-input capability (InputInbox): a finished recording
 * is a file in <filesDir>/memos/inbox, and a file still being written ends in .part and
 * is ignored.
 *
 *   <id>[.<dest>].ogg                   one memo, Ogg/Opus (Android 10 and later)
 *   <id>-<nn>[.<dest>]@<start ms>.m4a   one segment of a recording made on Android 8 or 9:
 *                                       a memo of its own, <id>-<nn>, with its own start time
 *
 * <dest> is the id of the destination the recording is for ("journal", "meal"). The
 * payload reads it from the name, so a recording still goes where it was meant to after
 * the process was killed. A recording with none is a voice memo for the journal.
 *
 * The payload is told of a new one over the "inputs" PayloadPort; when no payload is
 * loaded it finds the file at its next scan.
 */
final class MemoFiles {
    /** Under the app's files directory (InputInbox.DIR in the payload). */
    static final String INBOX = "memos/inbox";
    /** The PayloadPort the payload's capability serves (QuickInputCapability.PORT). */
    static final String PORT = "inputs";
    /** The one request that port takes from the recorder. */
    static final String RECORDED = "{\"op\":\"recorded\"}";
    /** Recordings that were cut off and cannot be played are kept here (InputInbox.CUT_OFF_DIR in the payload). */
    static final String CUT_OFF = "memos/cutoff";
    static final String OGG = ".ogg";
    static final String M4A = ".m4a";
    private static final String PART = ".part";
    /** The extra the record screen and the recorder are started with: the destination's id. */
    static final String EXTRA_DEST = "dest";
    /** The extra the record screen is started with: the destination's label, for its title. */
    static final String EXTRA_LABEL = "label";
    /** A destination's id, as the payload's Destinations.ID has it. */
    private static final java.util.regex.Pattern DEST = java.util.regex.Pattern.compile("[a-z][a-z0-9-]{0,31}");
    private static final int MAX_LABEL = 25;

    private MemoFiles() { }

    /** "<start ms>-<8 hex>": unique on this phone, and what the backend accepts as a memo id. */
    static String newId(long startMs, long random) {
        return startMs + "-" + String.format(Locale.ROOT, "%08x", random & 0xffffffffL);
    }

    /** What arrived in an intent as a destination: its id, or null when it is not one. Never a path. */
    static String dest(String raw) { return raw != null && DEST.matcher(raw).matches() ? raw : null; }

    /** What arrived in an intent as a label: 1 to 25 characters with no control character, or null. */
    static String label(String raw) {
        String label = raw == null ? "" : raw.trim();
        if (label.isEmpty() || label.length() > MAX_LABEL) return null;
        for (int i = 0; i < label.length(); i++) if (label.charAt(i) < 0x20 || label.charAt(i) == 0x7f) return null;
        return label;
    }

    /** "<id>.<dest>": what a recording for a destination is called; the id alone when it has none. */
    static String stem(String id, String dest) { return dest == null ? id : id + "." + dest; }

    /** The file a recording, or one segment of it, is written to. */
    static File part(File inbox, String stem, String suffix) { return new File(inbox, stem + suffix + PART); }

    /** "<memo id>-<nn>": the id of one segment, and what its part file is called. */
    static String segmentId(String memoId, int index) {
        return memoId + "-" + String.format(Locale.ROOT, "%02d", index);
    }

    /**
     * Renames a whole segment to "<memo id>-<nn>@<start ms>.m4a": the payload reads the
     * segment's own start time from the name. Null when that cannot be done.
     */
    static File finishSegment(File part, long segmentStartMs) {
        String path = part.getPath();
        if (!path.endsWith(M4A + PART) || !part.isFile()) return null;
        File done = new File(path.substring(0, path.length() - (M4A + PART).length()) + "@" + segmentStartMs + M4A);
        return part.renameTo(done) ? done : null;
    }

    /** Renames a whole recording to its final name. Null when that cannot be done. */
    static File finish(File part) {
        String path = part.getPath();
        if (!path.endsWith(PART) || !part.isFile()) return null;
        File done = new File(path.substring(0, path.length() - PART.length()));
        return part.renameTo(done) ? done : null;
    }
}
