package net.kckern.daylight.shellkit;

import net.kckern.daylight.api.PayloadPort;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Sends what the TelemetryStore holds, oldest batch first, the same way from every caller
 * (an open screen, the telemetry job, the background inbox job): seal the open batch,
 * hand each sealed one to the sender, delete it only once the backend has it (or refused
 * it for good, so one bad batch never holds back the rest), and stop at the first "later"
 * (offline, home down, no payload yet), leaving it and everything after it on disk.
 *
 * <p>Plain Java over the store and a sender, so it runs in JVM tests.
 */
public final class TelemetryDrain {
    public static final int SENT = 0, LATER = 1, REFUSED = 2;

    /** One batch out; answers SENT, LATER or REFUSED. Never throws. */
    public interface Sender { int send(JSONArray events); }

    /** What a drain did. */
    public static final class Result {
        public final int sent, refused, waiting;
        /** Something is still on the phone (a "later", or the store could not be read). */
        public final boolean left;
        Result(int sent, int refused, int waiting, boolean left) {
            this.sent = sent; this.refused = refused; this.waiting = waiting; this.left = left;
        }
        @Override public String toString() {
            return "sent " + sent + (refused > 0 ? ", refused " + refused : "") + ", waiting " + waiting;
        }
    }

    private TelemetryDrain() { }

    public static Result drain(TelemetryStore store, Sender sender) {
        int sent = 0, refused = 0;
        try {
            store.seal();
            for (TelemetryStore.Batch b = store.next(); b != null; b = store.next()) {
                int answer = sender.send(b.events);
                if (answer == LATER) return new Result(sent, refused, store.waiting(), true);
                if (answer == REFUSED) refused++; else sent++;
                store.ack(b);
            }
            return new Result(sent, refused, 0, false);
        } catch (Exception unreadable) {
            return new Result(sent, refused, safeWaiting(store), true);
        }
    }

    /** What a relay answer means for a batch: sent, try later (no network, home down, busy), or refused for good. */
    public static int outcome(JSONObject reply) {
        if (reply.optBoolean("ok", false)) return SENT;
        int status = reply.optInt("status", 0);
        boolean forGood = status >= 400 && status < 500 && status != 408 && status != 429;
        return forGood ? REFUSED : LATER;
    }

    /** The sender every caller uses: the payload's "telemetry" port, waiting up to waitMs for a payload. */
    public static Sender port(long waitMs) {
        return events -> {
            try {
                String reply = PayloadPort.named(UiTelemetry.PORT)
                        .call(new JSONObject().put("source", "android").put("events", events).toString(), waitMs);
                return outcome(new JSONObject(reply));
            } catch (Exception notNowOrBroken) {
                return LATER;
            }
        };
    }

    private static int safeWaiting(TelemetryStore store) {
        try { return store.waiting(); } catch (RuntimeException e) { return -1; }
    }
}
