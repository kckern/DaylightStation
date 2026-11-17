package net.kckern.daylight.cap.quickinput;

import java.io.File;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Finds finished inputs. Installed code (the recorder, the text screen, the photo
 * screen) writes a file ending .part and renames it when it is whole, so a file with
 * one of the endings below is always complete. No Android types.
 *
 * Recordings, in <filesDir>/memos/inbox:
 *
 *   <id>[.<dest>].ogg                   one memo, Ogg/Opus (Android 10 and later)
 *   <id>-<nn>[.<dest>]@<start ms>.m4a   one five-minute segment of a recording made on
 *                                       Android 8 or 9, an input of its own, <id>-<nn>
 *   <id>.m4a                            a whole MP4 memo from an earlier build
 *
 * Text and photos, in <filesDir>/inputs/inbox:
 *
 *   <id>.<dest>.txt                     typed text, UTF-8
 *   <id>.<dest>.jpg                     a photo, already scaled and without its EXIF
 *
 * <dest> is the destination's id. A recording with none is a voice memo for the
 * journal, which is what one made by an earlier build is. The kind is the ending.
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
    /** Where the text and photo screens write (CaptureFiles.INBOX in the shell half). Apart from the
     *  recordings: what the recorder's recovery does with a .part file is right for audio only. */
    static final String INPUTS_DIR = "inputs/inbox";
    static final String[] SUFFIXES = { ".ogg", ".m4a" };
    private static final String TEXT_SUFFIX = ".txt";
    private static final String PHOTO_SUFFIX = ".jpg";
    /** What the backend accepts as X-Daylight-Input-Id. */
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
            Destinations.Kind kind = null;
            for (String suffix : SUFFIXES) {
                if (name.endsWith(suffix)) { stem = name.substring(0, name.length() - suffix.length()); kind = Destinations.Kind.VOICE; }
            }
            if (name.endsWith(TEXT_SUFFIX)) { stem = name.substring(0, name.length() - TEXT_SUFFIX.length()); kind = Destinations.Kind.TEXT; }
            if (name.endsWith(PHOTO_SUFFIX)) { stem = name.substring(0, name.length() - PHOTO_SUFFIX.length()); kind = Destinations.Kind.PHOTO; }
            if (!f.isFile() || stem == null) continue;
            long recordedAt = -1;
            Matcher segment = STARTED_AT.matcher(stem);
            if (segment.matches()) {
                stem = segment.group(1);
                try { recordedAt = Long.parseLong(segment.group(2)); } catch (NumberFormatException notATime) { recordedAt = -1; }
            }
            // "<id>.<dest>": the destination's id is the part after the dot.
            String dest = null;
            int dot = stem.lastIndexOf('.');
            if (dot >= 0) {
                dest = stem.substring(dot + 1);
                stem = stem.substring(0, dot);
                if (!Destinations.ID.matcher(dest).matches()) continue;
            }
            // Only a recording can do without one: a memo from before there were destinations.
            if (dest == null && kind != Destinations.Kind.VOICE) continue;
            String id = stem;
            if (!ID.matcher(id).matches()) continue;
            // Nothing was captured. The backend would refuse an empty body.
            if (f.length() == 0) { f.delete(); continue; }
            if (recordedAt < 0) {
                Matcher time = LEADING_TIME.matcher(id);
                try { recordedAt = time.find() ? Long.parseLong(time.group(1)) : f.lastModified(); }
                catch (NumberFormatException notATime) { recordedAt = f.lastModified(); }
            }
            if (queue.add(id, f.getPath(), recordedAt, dest == null ? Destinations.MEMO_DESTINATION : dest, kind)) added++;
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
