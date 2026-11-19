package net.kckern.daylight.api;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/**
 * A marker that says: this app may be device owner, and it is not to apply owner policy.
 *
 * It is a file because three parties that cannot call each other have to agree on it.
 * The lifeline sets it when it releases owner policy for a payload that is broken. The
 * device-admin receiver sets it when ownership is transferred to this app, so that
 * arriving ownership applies nothing by itself. The lockdown payload reads it on every
 * decision and treats the app as not being in owner mode while it exists, and sets or
 * clears it for POST /lockdown/owner/release and /lockdown/owner/resume.
 *
 * It lives beside the payload's state and survives payload swaps, restarts and the
 * lifeline's settings reset.
 */
public final class OwnerHold {
    private OwnerHold() { }

    /** The payload directory of an app whose files directory is {@code filesDir}. */
    public static File payloadDir(File filesDir) { return new File(filesDir, "payloads"); }

    public static File marker(File payloadDir) { return new File(PayloadState.dir(payloadDir), "owner-hold"); }

    public static boolean isSet(File payloadDir) { return payloadDir != null && marker(payloadDir).isFile(); }

    /** Why the hold was set, or null when there is none. */
    public static String reason(File payloadDir) {
        if (!isSet(payloadDir)) return null;
        try {
            return new String(Files.readAllBytes(marker(payloadDir).toPath()), StandardCharsets.UTF_8).trim();
        } catch (Exception e) {
            return "(the reason could not be read)";
        }
    }

    /** True when the marker is in place afterwards. */
    public static boolean set(File payloadDir, String why) {
        try {
            File f = marker(payloadDir);
            File dir = f.getParentFile();
            if (dir != null) dir.mkdirs();
            Files.write(f.toPath(), String.valueOf(why).getBytes(StandardCharsets.UTF_8));
            return f.isFile();
        } catch (Exception e) {
            return false;
        }
    }

    /** True when no marker remains. */
    public static boolean clear(File payloadDir) {
        File f = marker(payloadDir);
        return !f.exists() || f.delete();
    }
}
