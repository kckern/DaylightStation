package net.kckern.daylight.cap.caractions.shell;

import net.kckern.daylight.shellkit.PackageFacts;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.LongSupplier;
import java.util.function.Supplier;

/**
 * The car screen's gate at the binder boundary. Pure.
 *
 * Every transaction that arrives at the exported car service is decided here by the
 * uid Binder reports for that transaction (CarHostPolicy: Android Auto's package, owned
 * by that uid, signed with the certificate pinned in car.hostPins). Only an allowed
 * transaction reaches the Car App Library's binder; any other is refused before the
 * library reads a byte of it, whatever its code: a car app call, the descriptor
 * query and a dump alike.
 *
 * Decided on every call against what is installed and pinned now, so an update,
 * removal or re-signing of the package takes effect at the next call. Decisions are
 * kept per uid for the screens' second check and the log; one uid's refusal never
 * touches another's.
 */
final class CarGate {
    enum Route { FORWARD, REFUSE }

    /** A refusal is logged at most this often per uid. */
    static final long LOG_EVERY_MS = 60_000;

    private final PackageFacts facts;
    private final Supplier<Map<String, String>> pins;
    private final LongSupplier clock;
    private final Map<Integer, CarHostPolicy.Decision> decisions = new ConcurrentHashMap<>();
    private final Map<Integer, Long> lastLogged = new ConcurrentHashMap<>();
    private final Map<Integer, String> pendingLog = new ConcurrentHashMap<>();

    CarGate(PackageFacts facts, Supplier<Map<String, String>> pins, LongSupplier clock) {
        this.facts = facts;
        this.pins = pins;
        this.clock = clock;
    }

    /** What to do with one transaction from this uid. The code does not matter: no code is let through for a refused uid. */
    Route route(int uid, int code) {
        CarHostPolicy.Decision d = CarHostPolicy.decide(uid, facts, pins.get());
        decisions.put(uid, d);
        if (d.allowed) return Route.FORWARD;
        long now = clock.getAsLong();
        Long last = lastLogged.get(uid);
        if (last == null || now - last >= LOG_EVERY_MS) {
            lastLogged.put(uid, now);
            pendingLog.put(uid, d.logLine());
        }
        return Route.REFUSE;
    }

    /** The last decision for this uid; null when it never called. */
    CarHostPolicy.Decision decisionFor(int uid) { return decisions.get(uid); }

    /** The refusal line due for this uid, once; null when none is due. */
    String takeLogLine(int uid) { return pendingLog.remove(uid); }
}
