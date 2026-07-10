package net.kckern.pianobridge;

/**
 * AudioGuardPolicy — the pure, Android-free decision core of the fail-closed audio
 * guard. Given an observed World, returns what should be true. Performs no I/O and
 * holds no state, so the reconciler that calls it is trivially idempotent.
 *
 * Fail-closed: any world that does not positively demonstrate a live A2DP route
 * gates the synth. See docs/_wip/plans/2026-07-09-piano-tablet-fail-closed-audio-guard.md.
 */
public final class AudioGuardPolicy {

    /** Observed state. `speakerIndex` is the STREAM_MUSIC index for the built-in speaker. */
    public static final class World {
        public final boolean a2dpConnected;      // BluetoothA2dp reports our MAC connected
        public final boolean a2dpOutputPresent;  // an A2DP device is in getDevices(OUTPUTS)
        public final boolean wiredPresent;       // headset/headphone/USB output present
        public final int     speakerIndex;       // current STREAM_MUSIC index for the speaker

        public World(boolean a2dpConnected, boolean a2dpOutputPresent,
                     boolean wiredPresent, int speakerIndex) {
            this.a2dpConnected = a2dpConnected;
            this.a2dpOutputPresent = a2dpOutputPresent;
            this.wiredPresent = wiredPresent;
            this.speakerIndex = speakerIndex;
        }
    }

    public static final class Decision {
        public final boolean routeOk;
        public final boolean gateSynth;           // true = VoiceHost must render silence
        public final boolean clampSpeakerVolume;  // true = setStreamVolume(MUSIC, 0)
        public final String  reason;

        Decision(boolean routeOk, boolean gateSynth, boolean clampSpeakerVolume, String reason) {
            this.routeOk = routeOk;
            this.gateSynth = gateSynth;
            this.clampSpeakerVolume = clampSpeakerVolume;
            this.reason = reason;
        }
    }

    private AudioGuardPolicy() { }

    public static Decision decide(World w) {
        if (w.a2dpConnected && w.a2dpOutputPresent) {
            return new Decision(true, false, false, "ok");
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
