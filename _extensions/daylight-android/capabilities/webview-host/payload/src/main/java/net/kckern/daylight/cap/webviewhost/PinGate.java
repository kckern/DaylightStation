package net.kckern.daylight.cap.webviewhost;

import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.LongSupplier;

/**
 * The page bridge's limit on pinMedia: one request per document every five seconds,
 * so a page cannot stack Android's pin dialogs. Pure. A document is its bridge token
 * (BridgeTokens): a new document has a new token and its own limit. A refused request
 * is counted.
 */
final class PinGate {
    static final long INTERVAL_MS = 5_000;
    /** Documents remembered at most, as BridgeTokens keeps tokens. */
    static final int MAX_DOCUMENTS = BridgeTokens.MAX_TOKENS;

    private final LongSupplier clock;
    private final Map<String, Long> lastAt = new LinkedHashMap<>();
    private long refused;

    PinGate(LongSupplier clock) { this.clock = clock; }

    /** True, and the time is taken, when this document may make a request now. */
    synchronized boolean allow(String token) {
        long now = clock.getAsLong();
        Long last = lastAt.get(token);
        if (last != null && now - last < INTERVAL_MS) {
            refused++;
            return false;
        }
        lastAt.remove(token);
        lastAt.put(token, now);
        for (Iterator<String> it = lastAt.keySet().iterator(); lastAt.size() > MAX_DOCUMENTS && it.hasNext(); ) {
            it.next();
            it.remove();
        }
        return true;
    }

    /** Requests refused for coming too soon, since this gate was made. */
    synchronized long refused() { return refused; }
}
