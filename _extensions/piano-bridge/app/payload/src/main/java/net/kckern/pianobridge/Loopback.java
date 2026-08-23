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

    /** Called after each probe verdict. Kicks the connector once per zombie episode. */
    void maybeKickZombie() {
        if (consecutiveMisses < ZOMBIE_MISSES) return;
        long now = System.currentTimeMillis();
        if (now - lastZombieKickMs < 10 * 60 * 1000L) return; // one kick per 10 min
        lastZombieKickMs = now;
        BleMidiConnector ble = core == null ? null : core.getBleConnector();
        Log.w(TAG, "ZOMBIE link: " + consecutiveMisses + " probes unanswered with BLE CONNECTED — forcing reconnect");
        CrashLog.note("LOOP", "ZOMBIE link (" + consecutiveMisses + " unanswered probes) — forcing BLE reconnect");
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
