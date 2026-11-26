package net.kckern.daylight.shellkit;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * The phone's telemetry, kept on disk until the backend has it: store and forward.
 *
 * <p>Every event is appended to {@code open.jsonl} the moment it happens, so nothing is
 * lost to a dead network, a killed process or a reboot. When the open file reaches
 * BATCH_EVENTS (or a flush asks), it is sealed: renamed to {@code batch-<n>.jsonl}, a
 * name that sorts in the order written. The sender takes the oldest sealed batch, and
 * {@link #ack} deletes it only after the backend has accepted it, so delivery is in
 * order and at least once (each event carries its own id for the backend to drop a
 * repeat). The store never grows past MAX_BYTES: the oldest batches go first, and the
 * number of events lost that way is itself reported, as a {@code telemetry.dropped}
 * event in the next batch sealed.
 *
 * <p>Plain java.io, so it runs in JVM tests. Thread-safe.
 */
public final class TelemetryStore {
    static final int BATCH_EVENTS = 40;
    static final long MAX_BYTES = 1_000_000;
    private static final String OPEN = "open.jsonl", DROPPED = "dropped.txt", PREFIX = "batch-", SUFFIX = ".jsonl";

    private final File dir;
    private long seq;

    public TelemetryStore(File dir) {
        this.dir = dir;
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        for (File f : sealed()) seq = Math.max(seq, number(f));
    }

    /** One event, written now. Seals the open batch when it is full. */
    public synchronized void append(JSONObject event) throws IOException {
        File open = new File(dir, OPEN);
        try (FileOutputStream out = new FileOutputStream(open, true)) {
            out.write((event.toString() + "\n").getBytes(StandardCharsets.UTF_8));
        }
        if (lines(open).size() >= BATCH_EVENTS) seal();
    }

    /** Closes the open batch so it can be sent. Nothing to seal is not an error. */
    public synchronized void seal() throws IOException {
        File open = new File(dir, OPEN);
        long dropped = readDropped();
        if ((!open.isFile() || open.length() == 0) && dropped == 0) return;
        if (dropped > 0) {
            try (FileOutputStream out = new FileOutputStream(open, true)) {
                JSONObject note = new JSONObject();
                try {
                    note.put("id", "dropped-" + System.currentTimeMillis()).put("event", "telemetry.dropped")
                            .put("level", "warn").put("ts", System.currentTimeMillis())
                            .put("data", new JSONObject().put("count", dropped));
                } catch (org.json.JSONException impossible) { throw new IOException(impossible); }
                out.write((note.toString() + "\n").getBytes(StandardCharsets.UTF_8));
            }
            writeDropped(0);
        }
        File batch = new File(dir, String.format(java.util.Locale.ROOT, "%s%019d%s", PREFIX, ++seq, SUFFIX));
        if (!open.renameTo(batch)) throw new IOException("could not seal the telemetry batch");
        trim();
    }

    /** The oldest sealed batch, or null when none waits. */
    public synchronized Batch next() throws IOException {
        List<File> files = sealed();
        if (files.isEmpty()) return null;
        File f = files.get(0);
        JSONArray events = new JSONArray();
        for (String line : lines(f)) {
            try { events.put(new JSONObject(line)); } catch (Exception torn) { /* a half-written line after a crash */ }
        }
        return new Batch(f, events);
    }

    /** The backend has this batch: forget it. */
    public synchronized void ack(Batch b) {
        //noinspection ResultOfMethodCallIgnored
        b.file.delete();
    }

    /** Sealed batches waiting, for logs and tests. */
    public synchronized int waiting() { return sealed().size(); }

    public static final class Batch {
        final File file;
        public final JSONArray events;
        Batch(File file, JSONArray events) { this.file = file; this.events = events; }
    }

    // ── internals ────────────────────────────────────────────────────────────

    /** Oldest batches out until the store fits, counting the events lost. */
    private void trim() throws IOException {
        List<File> files = sealed();
        long total = 0;
        for (File f : files) total += f.length();
        long lost = 0;
        for (int i = 0; total > MAX_BYTES && i < files.size() - 1; i++) {
            total -= files.get(i).length();
            lost += lines(files.get(i)).size();
            //noinspection ResultOfMethodCallIgnored
            files.get(i).delete();
        }
        if (lost > 0) writeDropped(readDropped() + lost);
    }

    private List<File> sealed() {
        File[] all = dir.listFiles((d, name) -> name.startsWith(PREFIX) && name.endsWith(SUFFIX));
        List<File> out = new ArrayList<>(all == null ? new ArrayList<>() : Arrays.asList(all));
        out.sort((a, b) -> a.getName().compareTo(b.getName()));
        return out;
    }

    private static long number(File f) {
        String n = f.getName().substring(PREFIX.length(), f.getName().length() - SUFFIX.length());
        try { return Long.parseLong(n); } catch (NumberFormatException e) { return 0; }
    }

    private static List<String> lines(File f) throws IOException {
        if (!f.isFile()) return new ArrayList<>();
        List<String> out = new ArrayList<>();
        for (String l : new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8).split("\n")) {
            if (!l.trim().isEmpty()) out.add(l);
        }
        return out;
    }

    private long readDropped() {
        File f = new File(dir, DROPPED);
        try { return f.isFile() ? Long.parseLong(new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8).trim()) : 0; }
        catch (Exception unreadable) { return 0; }
    }

    private void writeDropped(long n) throws IOException {
        File f = new File(dir, DROPPED);
        if (n == 0) { //noinspection ResultOfMethodCallIgnored
            f.delete(); return; }
        Files.write(f.toPath(), String.valueOf(n).getBytes(StandardCharsets.UTF_8));
    }
}
