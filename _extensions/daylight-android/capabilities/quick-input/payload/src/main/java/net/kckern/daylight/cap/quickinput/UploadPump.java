package net.kckern.daylight.cap.quickinput;

import net.kckern.daylight.cap.quickinput.InputUploader.Outcome;
import net.kckern.daylight.cap.quickinput.InputUploader.Result;

import java.io.File;

/**
 * One pass over the queue: everything that is due, one memo at a time. No threads
 * and no clock of its own, so it runs in JVM tests.
 *
 * The capture file is deleted here after the sender validates a receipt for its queue entry.
 */
final class UploadPump {
    interface Sender { Result upload(InputQueue.Entry memo); }

    /** Whether a network is up. With none, nothing is tried and no attempt is counted. */
    interface Link { boolean up(); }

    /** What one pass did. */
    static final class Pass {
        int uploaded;
        long uploadedBytes;
        int parked;
        int lost;
        boolean offline;
        /** Why nothing can be sent at all ("identity not configured"), or "". */
        String blocked = "";
        /** The backend does not take inputs from this phone for this user yet, for at least one destination. */
        boolean notAllowed;
        /** The destinations that answered so in this pass. */
        final java.util.Set<String> notAllowedDests = new java.util.LinkedHashSet<>();
        /** The destinations something was accepted for in this pass. */
        final java.util.Set<String> uploadedDests = new java.util.LinkedHashSet<>();
        /** The latest of the times in limits; 0 when no allowance was used up in this pass. */
        long limitUntilMs;
        /** Destination id to the time its daily allowance is back, for each that answered so in this pass. */
        final java.util.Map<String, Long> limits = new java.util.LinkedHashMap<>();
        /** The ids uploaded, for the log. */
        final java.util.List<String> uploadedIds = new java.util.ArrayList<>();
        final java.util.List<Long> sizes = new java.util.ArrayList<>();
    }

    private final InputQueue queue;
    private final Sender sender;
    private final Link link;
    private volatile boolean stopped;

    UploadPump(InputQueue queue, Sender sender, Link link) {
        this.queue = queue;
        this.sender = sender;
        this.link = link;
    }

    /**
     * The payload is stopping. An upload already under way finishes on its own, and
     * what it finds is left alone: the queue and the audio belong to the successor,
     * which sends the memo again and is answered as a duplicate.
     */
    void stop() {
        stopped = true;
        queue.close();
    }

    Pass drain(long nowMs) {
        Pass pass = new Pass();
        if (stopped) return pass;
        if (!link.up()) {
            pass.offline = true;
            return pass;
        }
        InputQueue.Entry memo;
        // Destinations that answered, in this pass, in a way every other input for them would
        // be answered too (not allowed yet). The rest of the queue goes on without them.
        java.util.Set<String> skip = new java.util.HashSet<>();
        while (!stopped && (memo = queue.claim(nowMs, skip)) != null) {
            File file = new File(memo.file);
            long bytes = file.length();
            Result result;
            try {
                result = sender.upload(memo);
            } catch (RuntimeException broke) {
                // The memo is marked as out. Left that way, nothing else would ever be sent.
                result = new Result(Outcome.RETRY, "failed: " + broke.getClass().getSimpleName());
            }
            if (stopped) return pass;
            switch (result.outcome) {
                case UPLOADED:
                    queue.uploaded(memo.id);
                    file.delete();
                    pass.uploaded++;
                    pass.uploadedBytes += bytes;
                    pass.uploadedDests.add(memo.dest);
                    pass.uploadedIds.add(memo.id + " " + memo.kind.word + " " + memo.dest);
                    pass.sizes.add(bytes);
                    break;
                case REJECTED:
                    queue.park(memo.id, result.detail);
                    pass.parked++;
                    break;
                case LOST:
                    queue.lost(memo.id);
                    pass.lost++;
                    break;
                case BLOCKED:
                    queue.release(memo.id);
                    pass.blocked = result.detail;
                    return pass;
                case WAIT: {
                    // The backend said when, for this destination: every input for it would get the
                    // same answer, so it is held. A limit on one bot does not hold the other.
                    long until = nowMs + result.waitMs;
                    pass.limits.put(memo.dest, until);
                    pass.limitUntilMs = Math.max(pass.limitUntilMs, until);
                    queue.holdUntil(memo.id, result.detail, until);
                    break;
                }
                case NOT_ALLOWED:
                    // This phone is not bound to the user for this destination's bot yet. It
                    // waits, uncounted; another destination may well be allowed.
                    pass.notAllowed = true;
                    pass.notAllowedDests.add(memo.dest);
                    skip.add(memo.dest);
                    queue.retryLater(memo.id, result.detail, false, nowMs);
                    break;
                default:
                    // Only what the intake itself answered, or may have received, counts toward parking.
                    if (queue.retryLater(memo.id, result.detail, result.outcome == Outcome.RETRY, nowMs)) pass.parked++;
                    // The link is down or the backend is unwell: the next memo would fail the
                    // same way. Stop, and let the wait decide when to look again.
                    return pass;
            }
        }
        return pass;
    }
}
