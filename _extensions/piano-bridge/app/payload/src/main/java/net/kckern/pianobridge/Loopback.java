package net.kckern.pianobridge;

import android.util.Log;

import org.json.JSONObject;

import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Loopback — the conclusive MIDI OUT assertion, using the piano as the witness.
 *
 * Every other witness on the OUT path is upstream of the piano: Android's port
 * state, the JamCorder's counters. "The counter went up" proves delivery to the
 * JamCorder's USB port, not to the instrument. On 2026-08-22/23 that gap let
 * "MIDI OUT is working" be reported while the piano stayed silent.
 *
 * The MDG-400 ECHOES MIDI: a note it receives on MIDI IN is re-transmitted on its
 * MIDI OUT (measured 2026-08-23: 16 note-ons + 16 note-offs sent via the APK,
 * 48 messages came back, nobody touching the keys). That echo arrives on the
 * bridge's own read port. So: send a note on a channel nobody plays, with a
 * velocity nobody uses, and watch for it to come back. If it does, the piano
 * received it — conclusively, by its own testimony. If it does not within the
 * window, OUT is dead somewhere between here and the piano's CPU.
 *
 * The probe note is C#-1 (note 1) at velocity 1: below the keyboard's range and
 * effectively inaudible. It is SENT on channel 16 but matched on note alone —
 * the piano echoes everything back on channel 1.
 * It is also sent with an immediate note-off so even a non-echoing synth is
 * not left with a hanging voice.
 *
 * What this CANNOT assert: that the piano SOUNDED. Reception and audio are
 * different failures (volume, local control, headphone jack). Reception is the
 * one that can be measured without ears; this measures it.
 */
public final class Loopback {

    private static final String TAG = "PianoBridge-Loop";
    static final int PROBE_NOTE = 1;
    static final int PROBE_CHANNEL = 15;   // 0-based: MIDI channel 16
    static final int PROBE_VELOCITY = 1;
    static final long WINDOW_MS = 1500;

    private final BridgeCore core;
    /** Probes in flight, keyed by sequence; value = send time. */
    private final ConcurrentHashMap<Long, Long> pending = new ConcurrentHashMap<>();
    private final AtomicLong seq = new AtomicLong();

    // Rolling verdict, surfaced in /loopback, /status and the heartbeat.
    private volatile long lastProbeAtMs;
    private volatile long lastEchoAtMs;
    private volatile long lastRttMs = -1;
    private volatile int consecutiveMisses;
    private volatile int probes, echoes;

    public Loopback(BridgeCore core) { this.core = core; }

    /**
     * Called from the inbound MidiReceiver for EVERY note-on, before the kiosk
     * fan-out. Returns true if this was our probe coming back (so the caller
     * can drop it instead of lighting a key on screen or waking the display).
     */
    public boolean onInboundNote(int status, int note, int velocity) {
        // Match on NOTE only, not channel. The MDG-400 echoes on channel 1 whatever
        // channel it received on (measured 2026-08-23: probe sent 9F 01 01, echo came
        // back 90 01 01). Note 1 (C#-1) is below the keyboard, so a real player can't
        // produce it; that alone makes the match unambiguous.
        if (note != PROBE_NOTE) return false;
        long now = System.currentTimeMillis();
        if (!pending.isEmpty()) {
            // Match the OLDEST outstanding probe; a late echo still counts.
            Long oldest = pending.keySet().stream().min(Long::compare).orElse(null);
            if (oldest != null) {
                Long sentAt = pending.remove(oldest);
                if (sentAt != null) {
                    lastRttMs = now - sentAt;
                    lastEchoAtMs = now;
                    consecutiveMisses = 0;
                    episodeKicks = 0;          // an echo ends the zombie episode:
                    episodeEscalations = 0;    // the ladder is re-armed from rung 1
                    lastEscalationMs = 0;      // and its backoff starts over
                    echoes++;
                    Log.i(TAG, "echo: probe " + oldest + " back in " + lastRttMs + "ms");
                }
            }
        }
        return true; // ours either way — never show the probe on the kiosk
    }

    /** Send one probe. Returns immediately; the verdict lands via onInboundNote. */
    public synchronized JSONObject probe() {
        JSONObject o = new JSONObject();
        long id = seq.incrementAndGet();
        byte[] on  = { (byte) (0x90 | PROBE_CHANNEL), (byte) PROBE_NOTE, (byte) PROBE_VELOCITY };
        byte[] off = { (byte) (0x80 | PROBE_CHANNEL), (byte) PROBE_NOTE, 0 };
        long now = System.currentTimeMillis();
        lastProbeAtMs = now;
        probes++;
        pending.put(id, now);
        boolean sent = core.sendMidi(on) && core.sendMidi(off);
        try {
            o.put("ok", true).put("probe", id).put("sent", sent).put("writeOpen", core.isMidiWriteOpen());
            if (!sent) { pending.remove(id); consecutiveMisses++; o.put("error", "write port refused the probe"); }
        } catch (Exception ignored) { }
        return o;
    }

    /**
     * Send a probe and BLOCK up to the window for the echo. This is the one-shot
     * assertion for pbctl / the e2e CLI: returns {echoed, rttMs}.
     */
    public JSONObject probeAndWait() {
        JSONObject o = probe();
        long id = o.optLong("probe");
        long deadline = System.currentTimeMillis() + WINDOW_MS;
        while (pending.containsKey(id) && System.currentTimeMillis() < deadline) {
            try { Thread.sleep(20); } catch (InterruptedException e) { break; }
        }
        boolean echoed = !pending.containsKey(id);
        if (!echoed) { pending.remove(id); consecutiveMisses++; maybeKickZombie(); }
        try {
            o.put("echoed", echoed);
            o.put("rttMs", echoed ? lastRttMs : JSONObject.NULL);
            o.put("verdict", echoed ? "PIANO RECEIVED IT (echoed in " + lastRttMs + "ms)"
                    : "NO ECHO in " + WINDOW_MS + "ms — OUT is dead between the tablet and the piano's CPU");
        } catch (Exception ignored) { }
        return o;
    }

    /**
     * Consecutive misses at which the link is declared a ZOMBIE and the BLE connector is
     * told to drop + reconnect. GATT-state-driven reconnect never fires for a zombie
     * (Android says CONNECTED); this is the only thing that does. Three misses = three
     * heartbeat cycles (~3 min) — long enough that a piano that is merely switched
     * off does not churn the radio every minute, short enough to matter at sea.
     */
    static final int ZOMBIE_MISSES = 3;
    private volatile long lastZombieKickMs;
    /** Kicks (L1 connectNow) fired in the CURRENT zombie episode; reset by any echo. */
    private volatile int episodeKicks;
    /** forceResetLink escalations spent in the CURRENT episode; reset by any echo. */
    private volatile int episodeEscalations;
    /** When the last escalation fired, for the backoff below. Reset by any echo. */
    private volatile long lastEscalationMs;

    /** Kicks required before the FIRST escalation of an episode. */
    static final int KICKS_BEFORE_ESCALATION = 2;
    static final long ESCALATION_BASE_BACKOFF_MS = 30L * 60_000L;   // 30 min
    static final long ESCALATION_MAX_BACKOFF_MS = 4L * 60 * 60_000L; // 4 h

    /**
     * How long to wait before the NEXT forceResetLink in this episode.
     *
     * 2026-08-26: this used to be a one-shot boolean (`episodeEscalated`) that was
     * set on the first escalation and cleared ONLY by an echo. When no echo ever
     * came, the strong rung fired exactly once per process lifetime and the ladder
     * degraded permanently to connectNow() every 10 minutes — 104 useless kicks
     * across 19 hours, churning the radio all night while never retrying the rung
     * that actually clears a zombie. A ladder must re-arm on CONTINUED FAILURE, not
     * only on success; anything reset solely by success is a ratchet that only turns
     * the wrong way.
     *
     * The original concern behind the one-shot was real — a piano that is simply
     * switched off must not bounce the tablet's Bluetooth (and the paired speaker
     * with it) every half hour all night. Exponential backoff keeps that property
     * while guaranteeing the strong rung is never abandoned: 0, 30m, 1h, 2h, then
     * 4h forever. A permanently dead link costs ~6 radio bounces a day, not 144.
     */
    long escalationBackoffMs() {
        if (episodeEscalations <= 0) return 0L;
        long backoff = ESCALATION_BASE_BACKOFF_MS << Math.min(episodeEscalations - 1, 3);
        return Math.min(backoff, ESCALATION_MAX_BACKOFF_MS);
    }

    /** Visible for tests: escalations spent in the current episode. */
    int episodeEscalations() { return episodeEscalations; }

    /** Visible for tests: seed escalation depth without driving the radio. */
    void setEscalationsForTest(int escalations) {
        this.episodeEscalations = escalations;
        this.lastEscalationMs = 0L;
    }

    /**
     * Visible for tests: register an outstanding probe without sending one.
     * probe() writes through the core, which the pure-logic tests construct as
     * null, so the echo path needs a way to have something to match against.
     */
    void addPendingProbeForTest() {
        pending.put(seq.incrementAndGet(), System.currentTimeMillis());
    }

    /**
     * Called after each probe verdict. Recovery ladder for a zombie link (BLE says
     * CONNECTED, piano never echoes):
     *   kick 1..2  — BleMidiConnector.connectNow(), one per 10 min (cheap, targeted)
     *   kick 3     — core.forceResetLink(): the full L1 forget/reconnect + L2 radio
     *                bounce ladder, echo-verified at each rung. Added in p12 because
     *                on 2026-08-23 connectNow alone kicked a zombie every 10 min for
     *                TEN HOURS without curing it, while one radio bounce fixed it in 9s.
     * Escalation REPEATS with exponential backoff (0, 30m, 1h, 2h, then 4h forever)
     * rather than running once per episode — see escalationBackoffMs() for why the
     * one-shot form left the link dead for 19 hours on 2026-08-26. The backoff is
     * what protects the original concern: a piano that is simply switched off must
     * not bounce the tablet's Bluetooth — and the paired speaker with it — every
     * half hour all night. An echo ends the episode and re-arms rung 1.
     */
    void maybeKickZombie() {
        if (consecutiveMisses < ZOMBIE_MISSES) return;
        long now = System.currentTimeMillis();
        if (now - lastZombieKickMs < 10 * 60 * 1000L) return; // one rung per 10 min
        lastZombieKickMs = now;
        boolean escalationDue = episodeKicks >= KICKS_BEFORE_ESCALATION
                && now - lastEscalationMs >= escalationBackoffMs();
        if (escalationDue) {
            episodeEscalations++;
            lastEscalationMs = now;
            Log.w(TAG, "ZOMBIE persists after " + episodeKicks + " reconnect kicks — escalating to forceResetLink"
                    + " (escalation " + episodeEscalations + ")");
            CrashLog.note("LOOP", "ZOMBIE survived " + episodeKicks + " BLE reconnects — auto force-reset #"
                    + episodeEscalations + " (L1+L2 ladder)");
            Thread t = new Thread(() -> {
                try { core.forceResetLink(); } catch (Throwable e) { Log.e(TAG, "auto force-reset failed", e); }
            }, "PianoBridge-AutoReset");
            t.setDaemon(true);
            t.start();
            return;
        }
        episodeKicks++;
        BleMidiConnector ble = core == null ? null : core.getBleConnector();
        Log.w(TAG, "ZOMBIE link: " + consecutiveMisses + " probes unanswered with BLE CONNECTED — forcing reconnect (kick " + episodeKicks + ")");
        CrashLog.note("LOOP", "ZOMBIE link (" + consecutiveMisses + " unanswered probes) — forcing BLE reconnect (kick " + episodeKicks + ")");
        if (ble != null) ble.connectNow();
    }

    /** Expire probes past the window so a dead link shows as misses, not pending forever. */
    public void reap() {
        long cutoff = System.currentTimeMillis() - WINDOW_MS;
        for (java.util.Map.Entry<Long, Long> e : pending.entrySet()) {
            if (e.getValue() < cutoff && pending.remove(e.getKey()) != null) consecutiveMisses++;
        }
    }

    public JSONObject snapshot() {
        reap();
        JSONObject o = new JSONObject();
        try {
            o.put("probes", probes);
            o.put("echoes", echoes);
            o.put("consecutiveMisses", consecutiveMisses);
            o.put("lastProbeAgoMs", lastProbeAtMs == 0 ? -1 : System.currentTimeMillis() - lastProbeAtMs);
            o.put("lastEchoAgoMs", lastEchoAtMs == 0 ? -1 : System.currentTimeMillis() - lastEchoAtMs);
            o.put("lastRttMs", lastRttMs);
            o.put("pending", pending.size());
            // The single field a human or an alarm should read.
            o.put("outVerified", lastEchoAtMs != 0 && consecutiveMisses == 0);
        } catch (Exception ignored) { }
        return o;
    }
}
