package net.kckern.daylight.cap.quickinput;

import java.io.File;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Finds finished recordings. The recorder (installed code) writes a file ending
 * .part into <filesDir>/memos/inbox and renames it when the recording is complete, so
 * a file ending .ogg or .m4a is always whole. No Android types.
 *
 *   <id>.ogg                    one memo, Ogg/Opus (Android 10 and later)
 *   <id>-<nn>@<start ms>.m4a    one five-minute segment of a recording made on Android 8
 *                               or 9, a memo of its own with the id <id>-<nn>
 *   <id>.m4a                    a whole MP4 memo from an earlier build
 *
 * A memo's time is when its recording started: the leading number of its id, or for
 * a segment the number after the @. The backend files the journal entry under it.
 *
 * A recording that was cut off (the app was killed) is never removed here. The
 * installed recorder knows whether a recording is under way, so recovering is its
 * (MemoRecovery in the shell half); what it recovers appears here as a finished file.
 */
final class InputInbox {
    /** Under the app's files directory. The recorder writes to the same place (MemoFiles.INBOX in the shell half). */
    static final String DIR = "memos/inbox";
    /** Recordings that were cut off and cannot be played are moved here, never deleted (MemoFiles.CUT_OFF). */
    static final String CUT_OFF_DIR = "memos/cutoff";
    static final String[] SUFFIXES = { ".ogg", ".m4a" };
    /** What the backend accepts as X-Daylight-Memo-Id. */
    static final Pattern ID = Pattern.compile("[A-Za-z0-9_-]{1,64}");
    private static final Pattern LEADING_TIME = Pattern.compile("^(\\d{10,16})(?:-|$)");
    private static final Pattern STARTED_AT = Pattern.compile("^(.+)@(\\d{10,16})$");

    private InputInbox() { }

    /** @return how many recordings were newly queued. */
    static int scan(File inbox, InputQueue queue) {
        File[] files = inbox.listFiles();
        if (files == null) return 0;
        int added = 0;
        for (File f : files) {
            String name = f.getName();
            String stem = null;
            for (String suffix : SUFFIXES) {
                if (name.endsWith(suffix)) stem = name.substring(0, name.length() - suffix.length());
            }
            if (!f.isFile() || stem == null) continue;
            long recordedAt = -1;
            Matcher segment = STARTED_AT.matcher(stem);
            if (segment.matches()) {
                stem = segment.group(1);
                try { recordedAt = Long.parseLong(segment.group(2)); } catch (NumberFormatException notATime) { recordedAt = -1; }
            }
            String id = stem;
            if (!ID.matcher(id).matches()) continue;
            // Nothing was captured. The backend would refuse an empty body.
            if (f.length() == 0) { f.delete(); continue; }
            if (recordedAt < 0) {
                Matcher time = LEADING_TIME.matcher(id);
                try { recordedAt = time.find() ? Long.parseLong(time.group(1)) : f.lastModified(); }
                catch (NumberFormatException notATime) { recordedAt = f.lastModified(); }
            }
            if (queue.add(id, f.getPath(), recordedAt)) added++;
        }
        return added;
    }

    /** How many recordings sit in the cut-off directory: kept, and not playable. */
    static int cutOffKept(File cutOffDir) {
        File[] files = cutOffDir.listFiles();
        int n = 0;
        if (files != null) for (File f : files) if (f.isFile()) n++;
        return n;
    }
}
