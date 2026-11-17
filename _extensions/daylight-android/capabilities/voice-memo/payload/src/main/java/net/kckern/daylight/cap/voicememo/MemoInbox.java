package net.kckern.daylight.cap.voicememo;

import java.io.File;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Finds finished recordings. The recorder (installed code) writes
 * <filesDir>/memos/inbox/<id>.m4a.part and renames it to <id>.m4a when the recording
 * is complete, so a file ending .m4a is always whole. No Android types.
 */
final class MemoInbox {
    /** Under the app's files directory. The recorder writes to the same place (MemoFiles.INBOX in the shell half). */
    static final String DIR = "memos/inbox";
    static final String SUFFIX = ".m4a";
    private static final String PART = ".part";
    /** What the backend accepts as X-Daylight-Memo-Id. */
    static final Pattern ID = Pattern.compile("[A-Za-z0-9_-]{1,64}");
    private static final Pattern LEADING_TIME = Pattern.compile("^(\\d{10,16})(?:-|$)");
    /**
     * A recording stops at 30 minutes. A .part file older than this is one whose
     * recorder is gone (the app was killed while recording): it has no index, cannot be
     * played, and is removed.
     */
    static final long CUT_OFF_AFTER_MS = 2 * 3_600_000L;

    private MemoInbox() { }

    /** @return how many recordings were newly queued. */
    static int scan(File inbox, MemoQueue queue) {
        File[] files = inbox.listFiles();
        if (files == null) return 0;
        int added = 0;
        for (File f : files) {
            String name = f.getName();
            if (!f.isFile() || !name.endsWith(SUFFIX)) continue;
            String id = name.substring(0, name.length() - SUFFIX.length());
            if (!ID.matcher(id).matches()) continue;
            // Nothing was captured. The backend would refuse an empty body.
            if (f.length() == 0) { f.delete(); continue; }
            Matcher time = LEADING_TIME.matcher(id);
            long recordedAt;
            try { recordedAt = time.find() ? Long.parseLong(time.group(1)) : f.lastModified(); }
            catch (NumberFormatException notATime) { recordedAt = f.lastModified(); }
            if (queue.add(id, f.getPath(), recordedAt)) added++;
        }
        return added;
    }

    /** Removes recordings that were cut off. @return how many */
    static int sweepCutOff(File inbox, long nowMs) {
        File[] files = inbox.listFiles();
        if (files == null) return 0;
        int removed = 0;
        for (File f : files) {
            if (f.isFile() && f.getName().endsWith(SUFFIX + PART) && nowMs - f.lastModified() > CUT_OFF_AFTER_MS && f.delete()) removed++;
        }
        return removed;
    }
}
