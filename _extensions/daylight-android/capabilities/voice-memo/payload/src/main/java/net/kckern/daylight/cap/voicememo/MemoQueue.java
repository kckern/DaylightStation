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
 *                        │ refused, or the 20th answered failure
 *                        ▼
 *                     PARKED  (the audio is kept; retryAll makes it due again)
 *
 * One memo is out at a time. A memo found UPLOADING at start was interrupted and is
 * queued again: the backend answers a repeat of the same id as a duplicate.
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

    private final File stateFile;
    private final List<Memo> memos = new ArrayList<>();
    private int uploaded;
    private int lost;
    private boolean closed;

    MemoQueue(File stateFile) {
        this.stateFile = stateFile;
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
        if (closed) return null;
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
        return next;
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
                .put("uploaded", uploaded).put("lost", lost).put("memos", list);
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
        }
    }

    /** Written beside the file and renamed over it, so a crash leaves the old state or the new, never half of one. */
    private void persist() {
        try {
            JSONArray list = new JSONArray();
            for (Memo m : memos) {
                list.put(new JSONObject().put("id", m.id).put("file", m.file).put("recordedAtMs", m.recordedAtMs)
                        .put("state", m.state.name()).put("attempts", m.attempts).put("failures", m.failures)
                        .put("nextAttemptAtMs", m.nextAttemptAtMs).put("lastError", m.lastError));
            }
            byte[] bytes = new JSONObject().put("uploaded", uploaded).put("lost", lost).put("memos", list)
                    .toString().getBytes(StandardCharsets.UTF_8);
            File dir = stateFile.getParentFile();
            if (dir != null) dir.mkdirs();
            File part = new File(stateFile.getPath() + ".part");
            try (FileOutputStream out = new FileOutputStream(part)) {
                out.write(bytes);
                out.getFD().sync();
            }
            if (!part.renameTo(stateFile)) throw new java.io.IOException("rename failed");
        } catch (Exception e) {
            throw new IllegalStateException("cannot persist the memo queue: " + e.getClass().getSimpleName(), e);
        }
    }
}
