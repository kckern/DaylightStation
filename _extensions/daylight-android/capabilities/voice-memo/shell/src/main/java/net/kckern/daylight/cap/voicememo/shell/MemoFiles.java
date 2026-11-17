package net.kckern.daylight.cap.voicememo.shell;

import java.io.File;
import java.util.Locale;

/**
 * Where a recording goes and what it is called. No Android types.
 *
 * Contract with the payload's voice-memo capability: a finished recording is
 * <filesDir>/memos/inbox/<id>.m4a, and a file still being written ends in .part and is
 * ignored. The payload is told of a new one over the "memos" PayloadPort; when no
 * payload is loaded it finds the file at its next scan.
 */
final class MemoFiles {
    /** Under the app's files directory (MemoInbox.DIR in the payload). */
    static final String INBOX = "memos/inbox";
    /** The PayloadPort the payload's capability serves (VoiceMemoCapability.PORT). */
    static final String PORT = "memos";
    /** The one request that port takes from the recorder. */
    static final String RECORDED = "{\"op\":\"recorded\"}";
    private static final String SUFFIX = ".m4a";
    private static final String PART = ".part";

    private MemoFiles() { }

    /** "<start ms>-<8 hex>": unique on this phone, and what the backend accepts as a memo id. */
    static String newId(long startMs, long random) {
        return startMs + "-" + String.format(Locale.ROOT, "%08x", random & 0xffffffffL);
    }

    static File part(File inbox, String id) { return new File(inbox, id + SUFFIX + PART); }

    /** Renames a whole recording to its final name. Null when that cannot be done. */
    static File finish(File part) {
        String path = part.getPath();
        if (!path.endsWith(PART) || !part.isFile()) return null;
        File done = new File(path.substring(0, path.length() - PART.length()));
        return part.renameTo(done) ? done : null;
    }

    /**
     * Removes what an earlier recorder left half written. Called when no recording is
     * under way, so every .part file is one whose recorder is gone. @return how many
     */
    static int removeCutOff(File inbox) {
        File[] files = inbox.listFiles();
        if (files == null) return 0;
        int removed = 0;
        for (File f : files) {
            if (f.isFile() && f.getName().endsWith(SUFFIX + PART) && f.delete()) removed++;
        }
        return removed;
    }
}
