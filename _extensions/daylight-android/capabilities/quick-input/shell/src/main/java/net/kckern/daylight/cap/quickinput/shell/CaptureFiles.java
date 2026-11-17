package net.kckern.daylight.cap.quickinput.shell;

import net.kckern.daylight.api.PayloadPort;

import java.io.File;
import java.io.FileOutputStream;
import java.util.regex.Pattern;

/**
 * Where typed text and photos go and what they are called. No Android types.
 *
 * Contract with the payload's quick-input capability (InputInbox): a finished input is
 * a file in <filesDir>/inputs/inbox named "<id>.<dest>.txt" or "<id>.<dest>.jpg", where
 * <dest> is the destination's id. A file still being written or captured ends in .part
 * and is ignored by the payload. This directory is apart from the recorder's: what the
 * recorder's recovery does with a .part file is right for audio only.
 *
 * The payload is told of a new input over the "inputs" PayloadPort; when no payload is
 * loaded it finds the file at its next scan.
 */
final class CaptureFiles {
    /** Under the app's files directory (InputInbox.INPUTS_DIR in the payload). */
    static final String INBOX = "inputs/inbox";
    static final String TEXT = ".txt";
    static final String PHOTO = ".jpg";
    static final String PART = ".part";
    /** A .part file older than this belongs to a screen that is gone. */
    static final long STALE_MS = 30 * 60_000L;
    /** "<start ms>-<8 hex>", as MemoFiles.newId makes it. */
    static final Pattern ID = Pattern.compile("[0-9]{10,16}-[0-9a-f]{8}");

    private CaptureFiles() { }

    /** "<id>.<dest><suffix>": what a finished input is called. */
    static String name(String id, String dest, String suffix) { return id + "." + dest + suffix; }

    /**
     * Writes a whole input: to a .part file, synced, then renamed, so the payload never
     * sees half of one. Null, and nothing left behind, when that cannot be done.
     */
    static File write(File inbox, String id, String dest, String suffix, byte[] body) {
        if (body == null || body.length == 0 || id == null || !ID.matcher(id).matches() || MemoFiles.dest(dest) == null) return null;
        if (!inbox.isDirectory() && !inbox.mkdirs()) return null;
        File done = new File(inbox, name(id, dest, suffix));
        File part = new File(inbox, done.getName() + PART);
        try {
            try (FileOutputStream out = new FileOutputStream(part)) {
                out.write(body);
                out.getFD().sync();
            }
            if (part.renameTo(done)) return done;
        } catch (Exception e) {
            // Falls through: nothing is kept.
        }
        part.delete();
        return null;
    }

    /**
     * Removes .part files nobody is writing any more: a screen that was killed part-way
     * left them. A photo not yet scaled still has where it was taken in it, so it is not
     * left lying about. A finished input is never touched here.
     *
     * @return how many were removed
     */
    static int sweep(File inbox, long nowMs) {
        File[] files = inbox.listFiles();
        if (files == null) return 0;
        int removed = 0;
        for (File f : files) {
            if (!f.isFile() || !f.getName().endsWith(PART)) continue;
            if (nowMs - f.lastModified() <= STALE_MS) continue;
            if (f.delete()) removed++;
        }
        return removed;
    }

    /** Tell the payload now. With none loaded, its next scan of the inbox finds the file. */
    static void tellPayload() {
        Thread tell = new Thread(() -> {
            try { PayloadPort.named(MemoFiles.PORT).call(MemoFiles.RECORDED, 0); }
            catch (Throwable noPayload) { /* found by the next scan */ }
        }, "Daylight-input-tell");
        tell.setDaemon(true);
        tell.start();
    }
}
