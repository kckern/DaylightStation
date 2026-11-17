package net.kckern.daylight.cap.voicememo.shell;

import java.io.File;

/**
 * What becomes of a recording that was cut off: the app was killed, or the phone
 * restarted, while it was being made. Nothing is ever deleted that holds audio. No
 * Android types.
 *
 * A file still being written ends in .part. One that no recorder is writing any more
 * is cut off:
 *
 *   <id>.ogg.part   Ogg is a stream of pages with its headers first, so what was written
 *                   plays up to where it stops. It becomes <id>.ogg, a finished memo
 *                   that the payload queues like any other. Its start time is in its id.
 *   *.m4a.part      An MP4 without the index its recorder writes at the end. Nothing
 *                   can play it. It is moved to memos/cutoff and kept there; the owner
 *                   is told.
 *   an empty file   Nothing was captured. Removed.
 *
 * Whether a recording is under way is known to the installed recorder alone, which
 * names it here (live). The payload asks for a recovery at each of its passes; the
 * recorder runs one before it starts a recording.
 */
public final class MemoRecovery {
    /** An Ogg file under this holds its headers and under a second of sound: not a memo. */
    static final long MIN_OGG_BYTES = 4096;
    private static final String PART = ".part";

    private static volatile String liveId;

    private MemoRecovery() { }

    /** What one recovery did. */
    public static final class Found {
        /** Cut-off recordings that are now finished memos in the inbox. */
        public int recovered;
        /** Cut-off recordings that cannot be played, moved to the cut-off directory. */
        public int unplayable;
    }

    /** The recorder's: the id of the recording under way, or null when none is. */
    static void live(String memoId) { liveId = memoId; }

    /** For the payload: recover under this app's files directory, leaving the recording under way alone. */
    public static Found recoverNow(File filesDir) {
        return recover(new File(filesDir, MemoFiles.INBOX), new File(filesDir, MemoFiles.CUT_OFF), liveId);
    }

    /**
     * @param live the id of the recording under way, whose files are left alone; null when none is
     */
    static Found recover(File inbox, File cutOffDir, String live) {
        Found found = new Found();
        File[] files = inbox.listFiles();
        if (files == null) return found;
        for (File f : files) {
            String name = f.getName();
            if (!f.isFile() || !name.endsWith(PART)) continue;
            if (live != null && name.startsWith(live)) continue;
            if (f.length() == 0) { f.delete(); continue; }
            String whole = name.substring(0, name.length() - PART.length());
            if (whole.endsWith(MemoFiles.OGG) && f.length() >= MIN_OGG_BYTES) {
                if (f.renameTo(new File(inbox, whole))) found.recovered++;
                continue;
            }
            // Not playable. Kept, out of the inbox, under its own name.
            if ((cutOffDir.isDirectory() || cutOffDir.mkdirs()) && f.renameTo(new File(cutOffDir, whole))) found.unplayable++;
        }
        return found;
    }
}
