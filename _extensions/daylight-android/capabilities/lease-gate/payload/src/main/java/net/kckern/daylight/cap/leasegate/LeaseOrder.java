package net.kckern.daylight.cap.leasegate;

import org.json.JSONObject;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/** Persists the ordering of lease commands (epoch, revision, blocked). Never a lease itself. */
final class LeaseOrder {
    private final File file;

    LeaseOrder(File file) { this.file = file; }

    LeaseDeadline load() {
        try {
            if (file.isFile()) {
                JSONObject o = new JSONObject(new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8));
                return new LeaseDeadline(o.getLong("epoch"), o.getLong("revision"), o.getBoolean("blocked"));
            }
        } catch (Exception unreadable) {
            // Fall through: unknown ordering, blocked.
        }
        return new LeaseDeadline();
    }

    boolean save(LeaseDeadline lease) {
        try {
            File dir = file.getParentFile();
            if (dir != null) dir.mkdirs();
            File part = new File(file.getPath() + ".part");
            Files.write(part.toPath(), new JSONObject()
                    .put("epoch", lease.epoch()).put("revision", lease.revision()).put("blocked", lease.desiredBlocked())
                    .toString().getBytes(StandardCharsets.UTF_8));
            return part.renameTo(file);
        } catch (Exception e) {
            return false;
        }
    }
}
