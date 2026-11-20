package net.kckern.daylight.cap.quickinput.shell;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Supplier;
import java.util.regex.Pattern;

/** Binding shared by the installed capture screens and the active inputs payload. */
public final class CaptureScope {
    public static final String EXTRA = "capture-owner";
    public static final String DIRECTORY_PREFIX = "owner-";
    private static final Pattern KEY = Pattern.compile("[0-9a-f]{64}");
    private static final AtomicReference<Supplier<String>> ACTIVE = new AtomicReference<>();

    private CaptureScope() { }

    public static void attach(Supplier<String> owner) { ACTIVE.set(owner); }

    public static void detach(Supplier<String> owner) { ACTIVE.compareAndSet(owner, null); }

    public static String current() {
        Supplier<String> active = ACTIVE.get();
        String key = active == null ? null : active.get();
        return active == ACTIVE.get() && valid(key) ? key : null;
    }

    static boolean currentIs(String key) { return valid(key) && key.equals(current()); }

    /** A restored camera request may stage its result privately before setup is available. */
    static boolean canOpenCameraSession(String owner, boolean restored) {
        return valid(owner) && (restored || currentIs(owner));
    }

    static boolean valid(String key) { return key != null && KEY.matcher(key).matches(); }

    /** Callers pass the canonical origin and configured user from the same settings snapshot. */
    public static String key(String canonicalOrigin, String user) {
        if (canonicalOrigin == null || user == null || user.isEmpty()) return null;
        try {
            byte[] bytes = MessageDigest.getInstance("SHA-256")
                    .digest((canonicalOrigin + '\0' + user).getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder(bytes.length * 2);
            for (byte value : bytes) {
                result.append(Character.forDigit((value >>> 4) & 15, 16));
                result.append(Character.forDigit(value & 15, 16));
            }
            return result.toString();
        } catch (NoSuchAlgorithmException impossible) {
            throw new AssertionError(impossible);
        }
    }

    public static File inbox(File base, String key) {
        if (!valid(key)) throw new IllegalArgumentException("Invalid capture owner");
        return new File(base, DIRECTORY_PREFIX + key);
    }

    /** Legacy flat inbox files have no binding. Malformed owner directories fail closed. */
    public static boolean allowsFile(File file, String current) {
        String directory = file.getParentFile() == null ? "" : file.getParentFile().getName();
        return !directory.startsWith(DIRECTORY_PREFIX) || valid(current) && directory.equals(DIRECTORY_PREFIX + current);
    }

}
