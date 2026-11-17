package net.kckern.daylight.cap.voicememo;

import net.kckern.daylight.core.backend.Backoff;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;

/**
 * Recordings waiting to be uploaded. Every change is written to disk before the
 * method returns, so the queue survives the process being killed and the phone being
 * restarted. No Android types.
 *
 *   QUEUED ──claim──► UPLOADING ──200──► gone (the audio is deleted by the pump)
 *     ▲                  │ no answer, or an answer that may change: wait 5 s, 10 s ... 1 h
 *     └──────────────────┘
 *                        │ refused for good (400, 413, 415, 422), or the 20th counted failure
 *                        ▼
 *                     PARKED  (the audio is kept; retryAll makes it due again, discardParked removes it)
 *
 * One memo is out at a time. A memo found UPLOADING at start was interrupted and is
 * queued again: the backend answers a repeat of the same id as a duplicate.
 *
 * The whole queue can be held until a time (the backend's daily allowance is used up):
 * nothing is claimed before it, whatever asks.
 *
 * A change that cannot be written is undone in memory before the failure is reported,
 * so a full disk never leaves a memo marked as out with nothing sending it.
 */
final class MemoQueue {
    static final long BASE_DELAY_MS = 5_000;
    static final long MAX_DELAY_MS = 3_600_000;
    /** Failures the backend answered (or may have received) before a memo is parked. */
    static final int MAX_ATTEMPTS = 20;

    enum State { QUEUED, UPLOADING, PARKED }

    static final class Memo {
        final String id;
        final String file;
        final long recordedAtMs;
        State state = State.QUEUED;
        /** Attempts that count toward MAX_ATTEMPTS. */
        int attempts;
        /** Every failure, counted or not: it sets the wait. */
        int failures;
        long nextAttemptAtMs;
        String lastError = "";

        Memo(String id, String file, long recordedAtMs) {
            this.id = id;
            this.file = file;
            this.recordedAtMs = recordedAtMs;
        }
    }

    /** Where the state goes. A test replaces it with one that fails. */
    interface Store { void write(byte[] bytes) throws Exception; }

    private final File stateFile;
    private final Store store;
    private final List<Memo> memos = new ArrayList<>();
    private int uploaded;
    private int lost;
    private int discarded;
    private long holdUntilMs;
    private boolean closed;

    MemoQueue(File stateFile) { this(stateFile, null); }

    MemoQueue(File stateFile, Store store) {
        this.stateFile = stateFile;
        this.store = store != null ? store : this::writeFile;
        load();
    }

    /** @return false when a memo with this id is already known. */
    synchronized boolean add(String id, String file, long recordedAtMs) {
        if (closed || find(id) != null) return false;
        memos.add(new Memo(id, file, recordedAtMs));
        persist();
        return true;
    }

    /** The oldest memo that is due, now marked UPLOADING; null when none is due or one is already out. */
    synchronized Memo claim(long nowMs) {
        if (closed || nowMs < holdUntilMs) return null;
        Memo oldest = null;
        for (Memo m : memos) {
            if (m.state == State.UPLOADING) return null;
            if (m.state != State.QUEUED || m.nextAttemptAtMs > nowMs) continue;
            if (oldest == null || m.recordedAtMs < oldest.recordedAtMs) oldest = m;
        }
        if (oldest == null) return null;
        oldest.state = State.UPLOADING;
        persist();
        return oldest;
    }

    /** The backend accepted it. */
    synchronized void uploaded(String id) {
        Memo m = find(id);
        if (closed || m == null) return;
        memos.remove(m);
        uploaded++;
        persist();
    }

    /** Its recording is no longer on the phone: there is nothing to send. */
    synchronized void lost(String id) {
        Memo m = find(id);
        if (closed || m == null) return;
        memos.remove(m);
        lost++;
        persist();
    }

    /** It was not tried (no identity, no site): due at once, and no attempt is counted. */
    synchronized void release(String id) {
        Memo m = find(id);
        if (closed || m == null) return;
        m.state = State.QUEUED;
        persist();
    }

    /**
     * It failed in a way that may change. Waits longer each time, up to an hour.
     *
     * @param counted whether the backend answered or may have received it. A failure to
     *                connect is not counted: a phone can be without its network for days.
     * @return true when this was the last attempt and the memo is now parked
     */
    synchronized boolean retryLater(String id, String error, boolean counted, long nowMs) {
        Memo m = find(id);
        if (closed || m == null) return false;
        m.failures++;
        if (counted) m.attempts++;
        m.lastError = error == null ? "" : error;
        boolean parked = m.attempts >= MAX_ATTEMPTS;
        if (parked) {
            m.state = State.PARKED;
        } else {
            m.state = State.QUEUED;
            m.nextAttemptAtMs = nowMs + Backoff.delayMs(m.failures, BASE_DELAY_MS, MAX_DELAY_MS);
        }
        persist();
        return parked;
    }

    /**
     * The backend said when it will take memos again (its daily allowance). The memo
     * goes back to the queue with no attempt counted, and nothing is claimed before
     * that time: not by the timer, and not by the owner asking to try again.
     */
    synchronized void holdUntil(String id, String error, long untilMs) {
        Memo m = find(id);
        if (closed || m == null) return;
        m.state = State.QUEUED;
        m.lastError = error == null ? "" : error;
        holdUntilMs = Math.max(holdUntilMs, untilMs);
        persist();
    }

    /** The time before which nothing is sent; 0 when there is none or it has passed. */
    synchronized long holdUntilMs(long nowMs) { return holdUntilMs > nowMs ? holdUntilMs : 0; }

    /**
     * The owner threw away what could not be sent. Parked memos leave the queue; the
     * caller deletes their audio.
     *
     * @return the audio files of the memos removed
     */
    synchronized List<String> discardParked() {
        List<String> files = new ArrayList<>();
        if (closed) return files;
        for (java.util.Iterator<Memo> it = memos.iterator(); it.hasNext(); ) {
            Memo m = it.next();
            if (m.state != State.PARKED) continue;
            files.add(m.file);
            it.remove();
            discarded++;
        }
        if (!files.isEmpty()) persist();
        return files;
    }

    /** The backend refused it for good. The audio is kept. */
    synchronized void park(String id, String error) {
        Memo m = find(id);
        if (closed || m == null) return;
        m.attempts++;
        m.lastError = error == null ? "" : error;
        m.state = State.PARKED;
        persist();
    }

    /** Waiting and parked memos are all due now, each with a fresh count. */
    synchronized void retryAll(long nowMs) {
        if (closed) return;
        for (Memo m : memos) {
            if (m.state == State.UPLOADING) continue;
            m.state = State.QUEUED;
            m.attempts = 0;
            m.failures = 0;
            m.nextAttemptAtMs = nowMs;
        }
        persist();
    }

    /** When the next queued memo is due, or -1 when nothing is queued. */
    synchronized long nextAttemptAtMs() {
        long next = -1;
        for (Memo m : memos) {
            if (m.state == State.QUEUED && (next < 0 || m.nextAttemptAtMs < next)) next = m.nextAttemptAtMs;
        }
        return next < 0 ? next : Math.max(next, holdUntilMs);
    }

    synchronized int waiting() {
        int n = 0;
        for (Memo m : memos) if (m.state != State.PARKED) n++;
        return n;
    }

    synchronized int parked() {
        int n = 0;
        for (Memo m : memos) if (m.state == State.PARKED) n++;
        return n;
    }

    /** After this the queue writes nothing: the state file belongs to a successor. */
    synchronized void close() { closed = true; }

    /** Ids, states and counts. No path: a file's name is its memo id. */
    synchronized JSONObject describe() throws JSONException {
        JSONArray list = new JSONArray();
        for (Memo m : memos) {
            list.put(new JSONObject().put("id", m.id).put("recordedAtMs", m.recordedAtMs).put("state", m.state.name())
                    .put("attempts", m.attempts).put("nextAttemptAtMs", m.nextAttemptAtMs).put("lastError", m.lastError));
        }
        return new JSONObject().put("ok", true).put("waiting", waiting()).put("parked", parked())
                .put("uploaded", uploaded).put("lost", lost).put("discarded", discarded)
                .put("holdUntilMs", holdUntilMs).put("memos", list);
    }

    private Memo find(String id) {
        for (Memo m : memos) if (m.id.equals(id)) return m;
        return null;
    }

    private void load() {
        try {
            if (!stateFile.isFile()) return;
            JSONObject doc = new JSONObject(new String(Files.readAllBytes(stateFile.toPath()), StandardCharsets.UTF_8));
            uploaded = doc.optInt("uploaded", 0);
            lost = doc.optInt("lost", 0);
            discarded = doc.optInt("discarded", 0);
            holdUntilMs = doc.optLong("holdUntilMs", 0);
            JSONArray list = doc.optJSONArray("memos");
            for (int i = 0; list != null && i < list.length(); i++) {
                try {
                    JSONObject o = list.getJSONObject(i);
                    Memo m = new Memo(o.getString("id"), o.getString("file"), o.optLong("recordedAtMs", 0));
                    State stored = State.valueOf(o.optString("state", "QUEUED"));
                    // The process ended mid-upload. The backend answers a repeated id as a duplicate.
                    m.state = stored == State.UPLOADING ? State.QUEUED : stored;
                    m.attempts = o.optInt("attempts", 0);
                    m.failures = o.optInt("failures", 0);
                    m.nextAttemptAtMs = o.optLong("nextAttemptAtMs", 0);
                    m.lastError = o.optString("lastError", "");
                    if (find(m.id) == null) memos.add(m);
                } catch (Exception unreadable) {
                    // That one entry is left out. Its recording is still in the inbox, and the
                    // next scan queues it again.
                }
            }
        } catch (Exception unreadable) {
            // A corrupt state file must not stop the payload. The recordings are still in
            // the inbox, and MemoInbox.scan() queues them again.
            memos.clear();
            uploaded = 0;
            lost = 0;
            discarded = 0;
            holdUntilMs = 0;
        }
        lastWritten = snapshot();
    }

    /** The state as it is on disk: what a change that cannot be written is undone to. */
    private String lastWritten = "";

    private String snapshot() {
        try {
            JSONArray list = new JSONArray();
            for (Memo m : memos) {
                list.put(new JSONObject().put("id", m.id).put("file", m.file).put("recordedAtMs", m.recordedAtMs)
                        .put("state", m.state.name()).put("attempts", m.attempts).put("failures", m.failures)
                        .put("nextAttemptAtMs", m.nextAttemptAtMs).put("lastError", m.lastError));
            }
            return new JSONObject().put("uploaded", uploaded).put("lost", lost).put("discarded", discarded)
                    .put("holdUntilMs", holdUntilMs).put("memos", list).toString();
        } catch (JSONException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    /** Puts the in-memory state back to a snapshot. UPLOADING is kept as written: the caller's change is what is undone. */
    private void restore(String snapshot) {
        try {
            JSONObject doc = new JSONObject(snapshot);
            memos.clear();
            uploaded = doc.optInt("uploaded", 0);
            lost = doc.optInt("lost", 0);
            discarded = doc.optInt("discarded", 0);
            holdUntilMs = doc.optLong("holdUntilMs", 0);
            JSONArray list = doc.optJSONArray("memos");
            for (int i = 0; list != null && i < list.length(); i++) {
                JSONObject o = list.getJSONObject(i);
                Memo m = new Memo(o.getString("id"), o.getString("file"), o.optLong("recordedAtMs", 0));
                m.state = State.valueOf(o.optString("state", "QUEUED"));
                m.attempts = o.optInt("attempts", 0);
                m.failures = o.optInt("failures", 0);
                m.nextAttemptAtMs = o.optLong("nextAttemptAtMs", 0);
                m.lastError = o.optString("lastError", "");
                memos.add(m);
            }
        } catch (JSONException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    /**
     * Every change ends here. When the state cannot be written (a full disk), the change
     * is undone in memory and the failure is thrown: the queue then says what the disk
     * says, and the next pass can try the same change again.
     */
    private void persist() {
        String next = snapshot();
        try {
            store.write(next.getBytes(StandardCharsets.UTF_8));
            lastWritten = next;
        } catch (Exception e) {
            restore(lastWritten);
            throw new IllegalStateException("cannot persist the memo queue: " + e.getClass().getSimpleName(), e);
        }
    }

    /** Written beside the file and renamed over it, so a crash leaves the old state or the new, never half of one. */
    private void writeFile(byte[] bytes) throws Exception {
        File dir = stateFile.getParentFile();
        if (dir != null) dir.mkdirs();
        File part = new File(stateFile.getPath() + ".part");
        try (FileOutputStream out = new FileOutputStream(part)) {
            out.write(bytes);
            out.getFD().sync();
        }
        if (!part.renameTo(stateFile)) throw new java.io.IOException("rename failed");
    }
}
