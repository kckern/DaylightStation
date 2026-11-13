package net.kckern.pianobridge;

/**
 * AudioGuardPolicy — the pure, Android-free decision core of the fail-closed audio
 * guard. Given an observed World, returns what should be true. Performs no I/O and
 * holds no state, so the reconciler that calls it is trivially idempotent.
 *
 * Fail-closed: any world that does not positively demonstrate a live A2DP route
 * gates the synth. See ops:docs/_wip/plans/2026-07-09-piano-tablet-fail-closed-audio-guard.md.
 *
 * A2DP volume floor (2026-11-13): the other direction. The guard used to stop at
 * "route OK" while the A2DP device's own STREAM_MUSIC index sat at 0/15, so every
 * surface read green and nothing played (2026-10-28 and again 2026-11-13). Since
 * FKB volumeLevels was emptied (2026-10-23) nothing else raises that index, and
 * AudioService persists it across reconnects and reboots. Now: once A2DP has been
 * the confirmed route for A2DP_SETTLE_MS, an index below max is raised to max.
 * The speaker is an external line-level receiver; loudness lives on its amp.
 */
public final class AudioGuardPolicy {

    /** Observed state. `speakerIndex` is the STREAM_MUSIC index for the built-in speaker. */
    public static final class World {
        public final boolean a2dpConnected;      // BluetoothA2dp reports our MAC connected
        public final boolean a2dpOutputPresent;  // an A2DP device is in getDevices(OUTPUTS)
        public final boolean wiredPresent;       // headset/headphone/USB output present
        /** STREAM_MUSIC index of the ACTIVE device: the speaker's when it is the route,
         *  the A2DP device's when that is the route. (API 29 has no per-device getter.) */
        public final int     speakerIndex;
        public final int     maxIndex;           // STREAM_MUSIC max; 0 = floor disabled
        public final long    routeOkForMs;       // how long A2DP has been continuously confirmed

        public World(boolean a2dpConnected, boolean a2dpOutputPresent,
                     boolean wiredPresent, int speakerIndex) {
            this(a2dpConnected, a2dpOutputPresent, wiredPresent, speakerIndex, 0, 0L);
        }

        public World(boolean a2dpConnected, boolean a2dpOutputPresent,
                     boolean wiredPresent, int speakerIndex, int maxIndex, long routeOkForMs) {
            this.a2dpConnected = a2dpConnected;
            this.a2dpOutputPresent = a2dpOutputPresent;
            this.wiredPresent = wiredPresent;
            this.speakerIndex = speakerIndex;
            this.maxIndex = maxIndex;
            this.routeOkForMs = routeOkForMs;
        }
    }

    public static final class Decision {
        public final boolean routeOk;
        public final boolean gateSynth;           // true = VoiceHost must render silence
        public final boolean clampSpeakerVolume;  // true = setStreamVolume(MUSIC, 0)
        public final String  reason;
        public final boolean raiseA2dpVolume;     // true = A2DP is the route and its index is low
        public final long    recheckInMs;         // >0 = reconcile again after this (floor settling)

        Decision(boolean routeOk, boolean gateSynth, boolean clampSpeakerVolume, String reason) {
            this(routeOk, gateSynth, clampSpeakerVolume, reason, false, 0L);
        }

        Decision(boolean routeOk, boolean gateSynth, boolean clampSpeakerVolume, String reason,
                 boolean raiseA2dpVolume, long recheckInMs) {
            this.routeOk = routeOk;
            this.gateSynth = gateSynth;
            this.clampSpeakerVolume = clampSpeakerVolume;
            this.reason = reason;
            this.raiseA2dpVolume = raiseA2dpVolume;
            this.recheckInMs = recheckInMs;
        }
    }

    /** A2DP must be the confirmed route this long before its index is raised, so a
     *  raise never races a connect/disconnect flap onto the built-in speaker. */
    public static final long A2DP_SETTLE_MS = 3_000L;

    private AudioGuardPolicy() { }

    public static Decision decide(World w) {
        if (w.a2dpConnected && w.a2dpOutputPresent) {
            // A wired output alongside A2DP makes the active device ambiguous — the
            // write could land on it. The sealed tablet never has one; don't guess.
            boolean low = w.maxIndex > 0 && !w.wiredPresent && w.speakerIndex < w.maxIndex;
            if (!low) return new Decision(true, false, false, "ok");
            if (w.routeOkForMs >= A2DP_SETTLE_MS) {
                return new Decision(true, false, false, "ok", true, 0L);
            }
            return new Decision(true, false, false, "ok", false, A2DP_SETTLE_MS - w.routeOkForMs);
        }
        // Gate closed from here down. Decide whether a clamp is also correct.
        final String reason =
                !w.a2dpOutputPresent ? (w.wiredPresent ? "wired_route" : "no_a2dp_output")
                                     : "not_connected";

        // API 29 cannot query the active route. Infer: the speaker is active iff no
        // A2DP and no wired output is connected. Clamping when a wired device is
        // present would write the WIRED index instead of the speaker's — so don't.
        final boolean speakerIsRoute = !w.a2dpOutputPresent && !w.wiredPresent;
        final boolean clamp = speakerIsRoute && w.speakerIndex > 0; // idempotent
        return new Decision(false, true, clamp, reason);
    }
}
