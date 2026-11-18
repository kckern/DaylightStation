package net.kckern.daylight.shell;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;

/**
 * PayloadStore is the on-disk state behind hot-swappable payloads.
 *
 * Pure Java, no Android, so every rule here is unit-tested on the JVM. Layout
 * under {@code dir}, which is app-private storage:
 *
 * <pre>
 *   payloads/
 *     p0-baked-v3.jar          the payload extracted from the APK with shell versionCode 3
 *     p-0123456789ab.jar       a pushed payload, named after its sha256
 *     current                  pointer file: ONE jar filename
 *     previous                 pointer file: the jar to fall back to
 *     shell-version            the shell stamp that last extracted its baked payload
 *     boots.&lt;jar&gt;              crash counter: newline-separated epoch-ms of each boot
 * </pre>
 *
 * Pointers are files, not symlinks: they work on every filesystem and are
 * replaced atomically (write a temp file, then rename). Their values are
 * reported by the lifeline's {@code GET /payload}.
 *
 * Rollback rule: a payload whose process starts {@link #CRASH_LIMIT} times within
 * {@link #CRASH_WINDOW_MS} while it is current is demoted, {@code current ← previous},
 * so a bad payload costs about ten minutes. The shell calls {@link #recordBoot} on
 * every start and {@link #shouldRollBack} before loading; the payload never touches this.
 */
public final class PayloadStore {

    public static final int CRASH_LIMIT = 3;
    public static final long CRASH_WINDOW_MS = 10 * 60 * 1000L;
    /** Jars with this prefix come out of the APK. A pushed payload is never stored under such a name. */
    static final String BAKED_PREFIX = "p0-baked";
    private static final String BOOTS_PREFIX = "boots.";
    private static final String SHELL_STAMP = "shell-version";

    private final File dir;

    public PayloadStore(File dir) {
        this.dir = dir;
        if (!dir.exists()) dir.mkdirs();
    }

    public File dir() { return dir; }

    // ── pointers ────────────────────────────────────────────────────────────

    public String current() { return readPointer("current"); }
    public String previous() { return readPointer("previous"); }

    public File currentJar() { String c = current(); return c == null ? null : new File(dir, c); }

    /** Make {@code jar} current, demoting the old current to previous. */
    public synchronized void activate(String jar) throws IOException {
        File f = new File(dir, jar);
        if (!f.isFile()) throw new IOException("no such payload: " + jar);
        String old = current();
        if (old != null && !old.equals(jar)) writePointer("previous", old);
        writePointer("current", jar);
    }

    /** current ← previous. Returns the jar now current, or null if nothing to fall back to. */
    public synchronized String rollback() throws IOException {
        String prev = previous();
        if (prev == null || !new File(dir, prev).isFile()) return null;
        String cur = current();
        writePointer("current", prev);
        // The broken one becomes "previous" so a deliberate re-activate is one step,
        // but its crash counter is left intact so it cannot bounce straight back.
        if (cur != null) writePointer("previous", cur); else deletePointer("previous");
        return prev;
    }

    // ── shell stamp ─────────────────────────────────────────────────────────

    /** The stamp of the shell that last extracted its baked payload here, or null. */
    public String shellStamp() { return readPointer(SHELL_STAMP); }

    public synchronized void recordShellStamp(String stamp) throws IOException { writePointer(SHELL_STAMP, stamp); }

    // ── crash accounting ────────────────────────────────────────────────────

    /** Record a boot of {@code jar} at {@code nowMs}. Keeps only the recent window. */
    public synchronized void recordBoot(String jar, long nowMs) throws IOException {
        List<Long> boots = boots(jar);
        boots.add(nowMs);
        StringBuilder sb = new StringBuilder();
        for (long t : boots) if (nowMs - t <= CRASH_WINDOW_MS) sb.append(t).append('\n');
        Files.write(bootsFile(jar).toPath(), sb.toString().getBytes(StandardCharsets.UTF_8));
    }

    /** Boots of {@code jar} inside the crash window ending at {@code nowMs}. */
    public int recentBoots(String jar, long nowMs) {
        int n = 0;
        for (long t : boots(jar)) if (nowMs - t <= CRASH_WINDOW_MS) n++;
        return n;
    }

    /**
     * True when the CURRENT payload has booted too often recently — i.e. it keeps
     * crashing the process. A clean stop resets the count ({@link #markCleanStop}).
     */
    public boolean shouldRollBack(long nowMs) {
        String cur = current();
        return cur != null && previous() != null && recentBoots(cur, nowMs) >= CRASH_LIMIT;
    }

    /** A deliberate, orderly stop of {@code jar}: clear its crash history. */
    public synchronized void markCleanStop(String jar) {
        bootsFile(jar).delete();
    }

    // ── inventory / integrity ───────────────────────────────────────────────

    public List<String> available() {
        List<String> out = new ArrayList<>();
        File[] fs = dir.listFiles();
        // boots.<jar> also ends in .jar; it is bookkeeping, not a payload.
        if (fs != null) for (File f : fs) {
            String n = f.getName();
            if (f.isFile() && n.endsWith(".jar") && !n.startsWith(BOOTS_PREFIX)) out.add(n);
        }
        java.util.Collections.sort(out);
        return out;
    }

    /** Lower-case hex sha256 of a file. */
    public static String sha256(File f) throws IOException {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            try (FileInputStream in = new FileInputStream(f)) {
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
            }
            StringBuilder sb = new StringBuilder();
            for (byte b : md.digest()) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IOException(e);
        }
    }

    /** The name a pushed payload is stored under: its content hash, never a name taken from the URL. */
    public static String pushedName(String sha256) {
        return "p-" + sha256.trim().toLowerCase(java.util.Locale.ROOT).substring(0, 12) + ".jar";
    }

    /**
     * Accept a downloaded {@code .part} file as payload {@code jar} only when its
     * sha256 matches. A download without a matching hash is refused and deleted.
     * A baked name is refused too: the fallback payload only ever comes from the APK.
     */
    public synchronized void commit(File part, String jar, String expectedSha256) throws IOException {
        if (jar.startsWith(BAKED_PREFIX) || jar.startsWith(BOOTS_PREFIX) || !jar.endsWith(".jar")) {
            part.delete();
            throw new IOException("not a name for a pushed payload: " + jar);
        }
        String got = sha256(part);
        if (expectedSha256 == null || !got.equalsIgnoreCase(expectedSha256.trim())) {
            part.delete();
            throw new IOException("sha256 mismatch: expected " + expectedSha256 + " got " + got);
        }
        File dst = new File(dir, jar);
        Files.move(part.toPath(), dst.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING);
    }

    // ── plumbing ────────────────────────────────────────────────────────────

    String recoveryReason() { return readPointer("last-recovery"); }
    boolean recoveryPending() { return new File(dir, "recovery-pending").exists(); }
    synchronized void recordRecovery(String reason) throws IOException {
        writePointer("recovery-pending", reason);
        writePointer("last-recovery", reason);
    }
    synchronized void finishRecovery() throws IOException {
        Files.deleteIfExists(new File(dir, "recovery-pending").toPath());
    }

    private File bootsFile(String jar) { return new File(dir, BOOTS_PREFIX + jar); }

    private List<Long> boots(String jar) {
        List<Long> out = new ArrayList<>();
        File f = bootsFile(jar);
        if (!f.isFile()) return out;
        try {
            for (String line : new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8).split("\n")) {
                line = line.trim();
                if (!line.isEmpty()) out.add(Long.parseLong(line));
            }
        } catch (Exception ignored) { }
        return out;
    }

    private String readPointer(String name) {
        File f = new File(dir, name);
        if (!f.isFile()) return null;
        try {
            String s = new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8).trim();
            return s.isEmpty() ? null : s;
        } catch (IOException e) { return null; }
    }

    private void writePointer(String name, String value) throws IOException {
        File tmp = new File(dir, name + ".tmp");
        Files.write(tmp.toPath(), value.getBytes(StandardCharsets.UTF_8));
        Files.move(tmp.toPath(), new File(dir, name).toPath(),
                java.nio.file.StandardCopyOption.REPLACE_EXISTING,
                java.nio.file.StandardCopyOption.ATOMIC_MOVE);
    }

    private void deletePointer(String name) { new File(dir, name).delete(); }
}
