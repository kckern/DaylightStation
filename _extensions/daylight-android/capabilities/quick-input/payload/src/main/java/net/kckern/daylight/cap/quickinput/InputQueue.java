package net.kckern.daylight.cap.quickinput;

import net.kckern.daylight.cap.quickinput.Destinations.Kind;
import net.kckern.daylight.cap.quickinput.shell.CaptureScope;
import net.kckern.daylight.core.backend.Backoff;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Predicate;

/**
 * Quick inputs (recordings, typed text, photos) waiting to be uploaded. One queue for
 * every kind: an entry remembers where it goes, what it is, what it is sent as, when it
 * was captured and the file that holds it. Every change is written to disk before the
 * method returns, so the queue survives the process being killed and the phone being
 * restarted. No Android types.
 *
 *   QUEUED ──claim──► UPLOADING ──200──► receipt saved, capture file removed
 *     ▲                  │ no answer, or an answer that may change: wait 5 s, 10 s ... 1 h
 *     └──────────────────┘
 *                        │ refused for good (400, 413, 415, 422), or the 20th counted failure
 *                        ▼
 *                     PARKED  (the audio is kept; retryAll makes it due again, discardParked removes it)
 *
 * One memo is out at a time. A memo found UPLOADING at start was interrupted and is
 * queued again: the backend answers a repeat of the same id as a duplicate.
 *
 * A destination can be held until a time (the backend's daily allowance for it is used
 * up): nothing for that destination is claimed before it, whatever asks. The other
 * destinations go on: a limit on one bot does not hold the other.
 *
 * A change that cannot be written is undone in memory before the failure is reported,
 * so a full disk never leaves a memo marked as out with nothing sending it.
 */
final class InputQueue {
    static final long BASE_DELAY_MS = 5_000;
    static final long MAX_DELAY_MS = 3_600_000;
    /** Failures the backend answered (or may have received) before a memo is parked. */
    static final int MAX_ATTEMPTS = 20;

    enum State { QUEUED, UPLOADING, PARKED }

    static final class Entry {
        final String id;
        final String file;
        /** When it was captured: sent as X-Daylight-Recorded-At. */
        final long recordedAtMs;
        /** The destination's id. Its route is looked up when the entry is sent. */
        final String dest;
        final Kind kind;
        /** What the intake is told the body is. */
        final String contentType;
        State state = State.QUEUED;
        /** Attempts that count toward MAX_ATTEMPTS. */
        int attempts;
        /** Every failure, counted or not: it sets the wait. */
        int failures;
        long nextAttemptAtMs;
        String lastError = "";

        /** A recording with no destination of its own: a voice memo for the journal. */
        Entry(String id, String file, long recordedAtMs) { this(id, file, recordedAtMs, Destinations.MEMO_DESTINATION, Kind.VOICE); }

        Entry(String id, String file, long recordedAtMs, String dest, Kind kind) {
            this(id, file, recordedAtMs, dest, kind, null);
        }

        Entry(String id, String file, long recordedAtMs, String dest, Kind kind, String contentType) {
            this.id = id;
            this.file = file;
            this.recordedAtMs = recordedAtMs;
            this.dest = dest == null || dest.isEmpty() ? Destinations.MEMO_DESTINATION : dest;
            this.kind = kind == null ? Kind.VOICE : kind;
            this.contentType = contentType == null || contentType.isEmpty() ? this.kind.contentType(file) : contentType;
        }
    }

    /** Where the state goes. A test replaces it with one that fails. */
    interface Store { void write(byte[] bytes) throws Exception; }

    private final File stateFile;
    private final Store store;
    private final List<Entry> memos = new ArrayList<>();
    private final Map<String, JSONArray> receipts = new LinkedHashMap<>();
    private final Map<String, String> captureNoticeStates = new LinkedHashMap<>();
    private int uploaded;
    private int lost;
    private int discarded;
    /** Destination id to the time before which nothing is sent to it. */
    private final Map<String, Long> holds = new LinkedHashMap<>();
    private boolean closed;

    InputQueue(File stateFile) { this(stateFile, null); }

    InputQueue(File stateFile, Store store) {
        this.stateFile = stateFile;
        this.store = store != null ? store : this::writeFile;
        load();
    }

    /** A recording with no destination of its own: a voice memo for the journal. */
    synchronized boolean add(String id, String file, long recordedAtMs) {
        return add(id, file, recordedAtMs, Destinations.MEMO_DESTINATION, Kind.VOICE);
    }

    /** @return false when an input with this id is already known. */
    synchronized boolean add(String id, String file, long recordedAtMs, String dest, Kind kind) {
        if (closed || find(id) != null) return false;
        Entry entry = new Entry(id, file, recordedAtMs, dest, kind);
        JSONArray completed = receipts.get(owner(entry));
        if (completed != null) {
            for (int i = 0; i < completed.length(); i++) {
                JSONObject prior = completed.optJSONObject(i);
                if (prior != null && id.equals(prior.optString("id"))) {
                    new File(file).delete();
                    return false;
                }
            }
        }
        memos.add(entry);
        persist();
        return true;
    }

    /** The oldest input that is due, now marked UPLOADING; null when none is due or one is already out. */
    synchronized Entry claim(long nowMs) { return claim(nowMs, Collections.<String>emptySet()); }

    /**
     * @param skip destinations to leave alone: ones that already answered, in this pass,
     *             in a way every other input for them would be answered too
     */
    synchronized Entry claim(long nowMs, Set<String> skip) {
        return claim(nowMs, skip, entry -> true);
    }

    synchronized Entry claim(long nowMs, Set<String> skip, Predicate<Entry> allowed) {
        if (closed) return null;
        Entry oldest = null;
        for (Entry m : memos) {
            if (m.state == State.UPLOADING) return null;
            if (m.state != State.QUEUED || m.nextAttemptAtMs > nowMs || !allowed.test(m)) continue;
            if (held(m) > nowMs || skip.contains(holdKey(m))) continue;
            if (oldest == null || m.recordedAtMs < oldest.recordedAtMs) oldest = m;
        }
        if (oldest == null) return null;
        oldest.state = State.UPLOADING;
        persist();
        return oldest;
    }

    /** The backend accepted it. */
    synchronized boolean uploaded(String id) {
        return finish(id, "ACCEPTED", null, null);
    }

    synchronized boolean finish(String id, String state, String entryId, String entryDate) {
        Entry m = find(id);
        if (closed || m == null) return false;
        String owner = owner(m);
        if (owner != null) {
            JSONObject receipt = row(m, state);
            try {
                receipt.put("entryId", entryId).put("entryDate", entryDate);
            } catch (JSONException invalid) {
                throw new IllegalStateException(invalid);
            }
            receipts.computeIfAbsent(owner, ignored -> new JSONArray()).put(receipt);
        }
        memos.remove(m);
        if ("LOST".equals(state)) lost++;
        else uploaded++;
        persist();
        return true;
    }

    /** Its recording is no longer on the phone: there is nothing to send. */
    synchronized void lost(String id) {
        finish(id, "LOST", null, null);
    }

    /** It was not tried (no identity, no site): due at once, and no attempt is counted. */
    /** A failed disk write ends the caller's claim. The disk still replays the same ID after a restart. */
    synchronized void releaseInterruptedClaim(String id, long nowMs) {
        Entry entry = find(id);
        if (!closed && entry != null && entry.state == State.UPLOADING) {
            entry.state = State.QUEUED;
            entry.lastError = "timeout";
            entry.nextAttemptAtMs = nowMs + BASE_DELAY_MS;
        }
    }

    synchronized void release(String id) {
        Entry m = find(id);
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
        Entry m = find(id);
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
     * The backend said when it will take inputs for this entry's destination again (its
     * daily allowance). The entry goes back to the queue with no attempt counted, and
     * nothing for that destination is claimed before that time: not by the timer, and
     * not by the owner asking to try again. Other destinations are not held.
     */
    synchronized void holdUntil(String id, String error, long untilMs) {
        Entry m = find(id);
        if (closed || m == null) return;
        m.state = State.QUEUED;
        m.lastError = error == null ? "" : error;
        holds.put(holdKey(m), Math.max(held(m), untilMs));
        persist();
    }

    static String holdKey(Entry entry) {
        String owner = owner(entry);
        return owner == null ? entry.dest : owner + ":" + entry.dest;
    }

    private long held(Entry entry) { return held(holdKey(entry)); }

    private long held(String dest) {
        Long until = holds.get(dest);
        return until == null ? 0 : until;
    }

    /** The latest time before which some destination is held; 0 when none is. */
    synchronized long holdUntilMs(long nowMs) {
        long latest = 0;
        for (long until : holds.values()) if (until > nowMs) latest = Math.max(latest, until);
        return latest;
    }

    /** The destinations held now, each with the time sending to it resumes. */
    synchronized Map<String, Long> holds(long nowMs) {
        Map<String, Long> out = new LinkedHashMap<>();
        for (Map.Entry<String, Long> h : holds.entrySet()) if (h.getValue() > nowMs && !h.getKey().contains(":")) out.put(h.getKey(), h.getValue());
        return out;
    }

    /**
     * The owner threw away what could not be sent. Parked memos leave the queue; the
     * caller deletes their audio.
     *
     * @return the audio files of the memos removed
     */
    synchronized List<String> discardParked(Predicate<Entry> allowed) {
        List<String> files = new ArrayList<>();
        if (closed) return files;
        for (java.util.Iterator<Entry> it = memos.iterator(); it.hasNext(); ) {
            Entry m = it.next();
            if (m.state != State.PARKED || !allowed.test(m)) continue;
            files.add(m.file);
            it.remove();
            discarded++;
        }
        if (!files.isEmpty()) persist();
        return files;
    }

    /** The backend refused it for good. The audio is kept. */
    synchronized void park(String id, String error) {
        Entry m = find(id);
        if (closed || m == null) return;
        m.attempts++;
        m.lastError = error == null ? "" : error;
        m.state = State.PARKED;
        persist();
    }

    /** The installed bulk action applies to the historical flat queue. */
    synchronized void retryAll(long nowMs) {
        if (closed) return;
        for (Entry m : memos) {
            if (m.state == State.UPLOADING || owner(m) != null) continue;
            m.state = State.QUEUED;
            m.attempts = 0;
            m.failures = 0;
            m.nextAttemptAtMs = nowMs;
        }
        persist();
    }

    static String owner(Entry entry) {
        File folder = new File(entry.file).getParentFile();
        if (folder == null || !folder.getName().startsWith(CaptureScope.DIRECTORY_PREFIX)) return null;
        return folder.getName().substring(CaptureScope.DIRECTORY_PREFIX.length());
    }

    private static boolean canRetry(Entry entry) {
        if (entry.state == State.UPLOADING) return false;
        return entry.state != State.PARKED || entry.attempts >= MAX_ATTEMPTS
                && !terminalRefusal(entry.lastError);
    }

    private static boolean terminalRefusal(String detail) {
        return detail.startsWith("HTTP 400 ") || detail.startsWith("HTTP 413 ")
                || detail.startsWith("HTTP 415 ") || detail.startsWith("HTTP 422 ")
                || "too large to send".equals(detail) || "unknown destination".equals(detail)
                || detail.startsWith("destination does not take ");
    }

    synchronized boolean retryCapture(String id, String owner, long nowMs) {
        Entry entry = find(id);
        if (closed || owner == null || entry == null || !owner.equals(owner(entry)) || !canRetry(entry)) return false;
        if (held(entry) > nowMs) return false;
        entry.state = State.QUEUED;
        entry.attempts = 0;
        entry.failures = 0;
        entry.nextAttemptAtMs = nowMs;
        entry.lastError = "";
        persist();
        return true;
    }

    synchronized JSONArray captureStatus(String owner, long nowMs) {
        JSONArray rows = new JSONArray();
        if (owner == null) return rows;
        for (Entry entry : memos) {
            if (!owner.equals(owner(entry))) continue;
            rows.put(row(entry, captureState(entry, nowMs)));
        }
        JSONArray completed = receipts.get(owner);
        if (completed != null) {
            for (int i = completed.length() - 1; i >= 0; i--) {
                JSONObject prior = completed.optJSONObject(i);
                if (prior != null) rows.put(prior);
            }
        }
        return rows;
    }

    private String captureState(Entry entry, long nowMs) {
        if (entry.state == State.UPLOADING) return "PROCESSING";
        if ("HTTP 422 unusable_input".equals(entry.lastError)) return "UNUSABLE";
        if ("HTTP 403 device_not_allowed".equals(entry.lastError)) return "DENIED";
        if (held(entry) > nowMs) return "WAIT";
        if (entry.state == State.PARKED) return canRetry(entry) ? "RETRY" : "REJECTED";
        if ("timeout".equals(entry.lastError)) return "UNCERTAIN";
        if (entry.failures > 0 && !"no connection".equals(entry.lastError)) return "RETRY";
        return "QUEUED";
    }

    synchronized String captureNoticeState(String id) {
        return captureNoticeStates.get(id);
    }

    synchronized boolean rememberCaptureNotice(String id, String state) {
        if (closed || java.util.Objects.equals(state, captureNoticeStates.get(id))) return false;
        if (state == null) captureNoticeStates.remove(id);
        else captureNoticeStates.put(id, state);
        persist();
        return true;
    }

    synchronized Map<String, JSONArray> otherCaptureStatuses(String current, long nowMs) {
        Map<String, JSONArray> other = new LinkedHashMap<>();
        java.util.Set<String> owners = new java.util.LinkedHashSet<>(receipts.keySet());
        for (Entry entry : memos) {
            String owner = owner(entry);
            if (owner != null) owners.add(owner);
        }
        for (String owner : owners) {
            if (!owner.equals(current)) other.put(owner, captureStatus(owner, nowMs));
        }
        return other;
    }

    private static JSONObject row(Entry entry, String state) {
        try {
            return new JSONObject().put("id", entry.id).put("dest", entry.dest).put("kind", entry.kind.word)
                    .put("state", state).put("recordedAtMs", entry.recordedAtMs);
        } catch (JSONException invalid) {
            throw new IllegalStateException(invalid);
        }
    }

    /** When the next queued input is due, its destination's hold included; -1 when nothing is queued. */
    synchronized long nextAttemptAtMs() { return nextAttemptAtMs(entry -> true); }

    synchronized long nextAttemptAtMs(Predicate<Entry> allowed) {
        long next = -1;
        for (Entry m : memos) {
            if (m.state != State.QUEUED || !allowed.test(m)) continue;
            long due = Math.max(m.nextAttemptAtMs, held(m));
            if (next < 0 || due < next) next = due;
        }
        return next;
    }

    /** Destination id to how many inputs for it are queued or being sent. */
    synchronized Map<String, Integer> waitingByDest() { return byDest(false); }

    /** Destination id to how many inputs for it are parked. */
    synchronized Map<String, Integer> parkedByDest() { return byDest(true); }

    private Map<String, Integer> byDest(boolean parked) {
        Map<String, Integer> out = new LinkedHashMap<>();
        for (Entry m : memos) {
            if (owner(m) != null || (m.state == State.PARKED) != parked) continue;
            Integer n = out.get(m.dest);
            out.put(m.dest, n == null ? 1 : n + 1);
        }
        return out;
    }

    synchronized int waiting() {
        int n = 0;
        for (Entry m : memos) if (m.state != State.PARKED) n++;
        return n;
    }

    synchronized int parked() { return parked(entry -> true); }

    synchronized int parked(Predicate<Entry> allowed) {
        int n = 0;
        for (Entry m : memos) if (m.state == State.PARKED && allowed.test(m)) n++;
        return n;
    }

    /** After this the queue writes nothing: the state file belongs to a successor. */
    synchronized void close() { closed = true; }

    /** Ids, kinds, destinations, states and counts. No path, and nothing of what an input holds. */
    synchronized JSONObject describe() throws JSONException { return describe(null, true); }

    synchronized JSONObject describe(String owner, boolean all) throws JSONException {
        JSONArray list = new JSONArray();
        int waiting = 0;
        int parked = 0;
        for (Entry m : memos) {
            if (!all && owner(m) != null && !owner(m).equals(owner)) continue;
            if (m.state == State.PARKED) parked++;
            else waiting++;
            list.put(new JSONObject().put("id", m.id).put("kind", m.kind.word).put("dest", m.dest)
                    .put("recordedAtMs", m.recordedAtMs).put("state", m.state.name())
                    .put("attempts", m.attempts).put("nextAttemptAtMs", m.nextAttemptAtMs).put("lastError", m.lastError));
        }
        return new JSONObject().put("ok", true).put("waiting", waiting).put("parked", parked)
                .put("uploaded", uploaded).put("lost", lost).put("discarded", discarded)
                .put("holds", new JSONObject(holds(Long.MIN_VALUE))).put("inputs", list);
    }

    private Entry find(String id) {
        for (Entry m : memos) if (m.id.equals(id)) return m;
        return null;
    }

    private void load() {
        try {
            if (!stateFile.isFile()) return;
            JSONObject doc = new JSONObject(new String(Files.readAllBytes(stateFile.toPath()), StandardCharsets.UTF_8));
            uploaded = doc.optInt("uploaded", 0);
            lost = doc.optInt("lost", 0);
            discarded = doc.optInt("discarded", 0);
            readHolds(doc);
            readReceipts(doc);
            readCaptureNoticeStates(doc);
            for (JSONObject o : entriesOf(doc)) {
                try {
                    Entry m = entryOf(o);
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
            // the inbox, and InputInbox.scan() queues them again.
            memos.clear();
            uploaded = 0;
            lost = 0;
            discarded = 0;
            holds.clear();
            receipts.clear();
            captureNoticeStates.clear();
        }
        lastWritten = snapshot();
    }

    /** Earlier readers see only flat inputs. A scoped-aware reader loads both arrays. */
    private static List<JSONObject> entriesOf(JSONObject doc) {
        JSONArray unbound = doc.optJSONArray("inputs");
        if (unbound == null) unbound = doc.optJSONArray("memos");
        List<JSONObject> entries = new ArrayList<>();
        for (JSONArray list : new JSONArray[] { unbound, doc.optJSONArray("ownedInputs") }) {
            if (list == null) continue;
            for (int i = 0; i < list.length(); i++) {
                JSONObject entry = list.optJSONObject(i);
                if (entry != null) entries.add(entry);
            }
        }
        return entries;
    }

    /** An entry written before there were destinations has neither: it is a voice memo for the journal. */
    private static Entry entryOf(JSONObject o) throws JSONException {
        return new Entry(o.getString("id"), o.getString("file"), o.optLong("recordedAtMs", 0),
                o.optString("dest", ""), Kind.of(o.optString("kind", Kind.VOICE.word)), o.optString("contentType", ""));
    }

    /** "holds" by destination; the one "holdUntilMs" of an earlier file was the journal's. */
    private void readHolds(JSONObject doc) {
        holds.clear();
        JSONObject stored = doc.optJSONObject("holds");
        if (stored != null) {
            for (Iterator<String> it = stored.keys(); it.hasNext(); ) {
                String dest = it.next();
                long until = stored.optLong(dest, 0);
                if (until > 0) holds.put(dest, until);
            }
        }
        long old = doc.optLong("holdUntilMs", 0);
        if (old > 0) holds.put(Destinations.MEMO_DESTINATION, Math.max(old, held(Destinations.MEMO_DESTINATION)));
    }

    private void readReceipts(JSONObject doc) {
        receipts.clear();
        JSONObject saved = doc.optJSONObject("captureReceipts");
        if (saved == null) return;
        for (Iterator<String> owners = saved.keys(); owners.hasNext();) {
            String owner = owners.next();
            JSONArray list = saved.optJSONArray(owner);
            if (list != null) receipts.put(owner, list);
        }
    }

    private void readCaptureNoticeStates(JSONObject doc) {
        captureNoticeStates.clear();
        JSONObject saved = doc.optJSONObject("captureNoticeStates");
        if (saved == null) return;
        for (Iterator<String> ids = saved.keys(); ids.hasNext();) {
            String id = ids.next();
            captureNoticeStates.put(id, saved.optString(id));
        }
    }

    /** The state as it is on disk: what a change that cannot be written is undone to. */
    private String lastWritten = "";

    private String snapshot() {
        try {
            JSONArray unbound = new JSONArray();
            JSONArray owned = new JSONArray();
            for (Entry m : memos) {
                File directory = new File(m.file).getParentFile();
                JSONArray list = directory != null && directory.getName().startsWith(CaptureScope.DIRECTORY_PREFIX)
                        ? owned : unbound;
                list.put(new JSONObject().put("id", m.id).put("file", m.file).put("recordedAtMs", m.recordedAtMs)
                        .put("dest", m.dest).put("kind", m.kind.word).put("contentType", m.contentType)
                        .put("state", m.state.name()).put("attempts", m.attempts).put("failures", m.failures)
                        .put("nextAttemptAtMs", m.nextAttemptAtMs).put("lastError", m.lastError));
            }
            return new JSONObject().put("uploaded", uploaded).put("lost", lost).put("discarded", discarded)
                    .put("holds", new JSONObject(holds)).put("captureReceipts", new JSONObject(receipts))
                    .put("captureNoticeStates", new JSONObject(captureNoticeStates))
                    .put("inputs", unbound).put("ownedInputs", owned).toString();
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
            readHolds(doc);
            readReceipts(doc);
            readCaptureNoticeStates(doc);
            for (JSONObject o : entriesOf(doc)) {
                Entry m = entryOf(o);
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
            throw new IllegalStateException("cannot persist the input queue: " + e.getClass().getSimpleName(), e);
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
