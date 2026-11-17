package net.kckern.daylight.cap.notifications;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.SecureRandom;

/** A per-install secret. Lives beside the settings overrides, so a payload swap keeps it. */
final class LinkKey {
    private LinkKey() { }

    /**
     * The stored key, or a new one. When the file cannot be written the new key still
     * works until the payload stops; links built with it stop working after that, and
     * the surfaces are rebuilt with the next key at the next start.
     */
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
