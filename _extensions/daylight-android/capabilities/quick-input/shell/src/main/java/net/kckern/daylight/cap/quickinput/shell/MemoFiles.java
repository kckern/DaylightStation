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
 *   <id>.ogg                    one memo, Ogg/Opus (Android 10 and later)
 *   <id>-<nn>@<start ms>.m4a    one segment of a recording made on Android 8 or 9: a
 *                               memo of its own, <id>-<nn>, with its own start time
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

    private MemoFiles() { }

    /** "<start ms>-<8 hex>": unique on this phone, and what the backend accepts as a memo id. */
    static String newId(long startMs, long random) {
        return startMs + "-" + String.format(Locale.ROOT, "%08x", random & 0xffffffffL);
    }

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
