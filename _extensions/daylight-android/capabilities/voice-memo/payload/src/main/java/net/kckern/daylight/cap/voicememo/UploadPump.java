package net.kckern.daylight.cap.voicememo;

import net.kckern.daylight.cap.voicememo.MemoUploader.Outcome;
import net.kckern.daylight.cap.voicememo.MemoUploader.Result;

import java.io.File;

/**
 * One pass over the queue: everything that is due, one memo at a time. No threads
 * and no clock of its own, so it runs in JVM tests.
 *
 * The audio of a memo is deleted in one place, here, after the backend accepted it.
 */
final class UploadPump {
    interface Sender { Result upload(MemoQueue.Memo memo); }

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
        /** The ids uploaded, for the log. */
        final java.util.List<String> uploadedIds = new java.util.ArrayList<>();
        final java.util.List<Long> sizes = new java.util.ArrayList<>();
    }

    private final MemoQueue queue;
    private final Sender sender;
    private final Link link;
    private volatile boolean stopped;

    UploadPump(MemoQueue queue, Sender sender, Link link) {
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
        MemoQueue.Memo memo;
        while (!stopped && (memo = queue.claim(nowMs)) != null) {
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
                    pass.uploadedIds.add(memo.id);
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
                default:
                    if (queue.retryLater(memo.id, result.detail, result.outcome == Outcome.RETRY, nowMs)) pass.parked++;
                    // The link is down or the backend is unwell: the next memo would fail the
                    // same way. Stop, and let the wait decide when to look again.
                    return pass;
            }
        }
        return pass;
    }
}
