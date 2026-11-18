package net.kckern.daylight.cap.notifications;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.SecureRandom;

/**
 * The link key: what a daylight:// link that does something must carry. Made on the
 * phone and kept beside the settings overrides. It is replaced at every payload start
 * (rotate), so a link that was seen once, in a log or over a shoulder, stops working;
 * the app's own surfaces are rebuilt with the new key at the same moment.
 */
final class LinkKey {
    private LinkKey() { }

    /**
     * The stored key, or a new one. When the file cannot be written the new key still
     * works until the payload stops; links built with it stop working after that, and
     * the surfaces are rebuilt with the next key at the next start.
     */
    /** The key now in force, and the one it replaced ("" when there was none). */
    static final class Rotation {
        final String current;
        final String previous;

        Rotation(String current, String previous) {
            this.current = current;
            this.previous = previous;
        }
    }

    /** Replace the stored key. When the new one cannot be written it still works until the payload stops. */
    static Rotation rotate(File file) {
        String previous = "";
        try {
            if (file.isFile()) {
                String existing = new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8).trim();
                if (existing.length() >= 32) previous = existing;
            }
        } catch (Exception unreadable) {
            // No previous key, then.
        }
        try { file.delete(); } catch (RuntimeException ignored) { }
        return new Rotation(loadOrCreate(file), previous);
    }

    static String loadOrCreate(File file) {
        try {
            if (file.isFile()) {
                String existing = new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8).trim();
                if (existing.length() >= 32) return existing;
            }
        } catch (Exception unreadable) {
            // Fall through to a new key.
        }
        byte[] random = new byte[16];
        new SecureRandom().nextBytes(random);
        StringBuilder hex = new StringBuilder();
        for (byte b : random) hex.append(String.format("%02x", b));
        try {
            File dir = file.getParentFile();
            if (dir != null) dir.mkdirs();
            Files.write(file.toPath(), hex.toString().getBytes(StandardCharsets.UTF_8));
        } catch (Exception notStored) {
            // Kept in memory only; see above.
        }
        return hex.toString();
    }
}
