package net.kckern.daylight.cap.midibridge;

import org.json.JSONException;
import org.json.JSONObject;

/** MIDI bytes and note frames as they cross the control API. Pure functions. */
final class MidiWire {
    private MidiWire() { }

    /**
     * Parse a MIDI byte string: "F0 41 10 F7", "f0,41,10,f7" or "F0411 0F7" all work.
     * Rejects odd-length and non-hex input loudly rather than sending a truncated
     * SysEx — a half-sent SysEx can leave the synth waiting for a terminator.
     */
    static byte[] parseHexBytes(String s) {
        String clean = s.replaceAll("(?i)0x", "").replaceAll("[^0-9a-fA-F]", "");
        if (clean.isEmpty()) return new byte[0];
        if (clean.length() % 2 != 0) {
            throw new IllegalArgumentException("odd number of hex digits (" + clean.length() + ")");
        }
        byte[] out = new byte[clean.length() / 2];
        for (int i = 0; i < out.length; i++) {
            out[i] = (byte) Integer.parseInt(clean.substring(i * 2, i * 2 + 2), 16);
        }
        return out;
    }

    /**
     * Convert an android.media.midi event timestamp (System.nanoTime() base) to epoch
     * ms, given a (currentTimeMillis, nanoTime) pair sampled together. A timestamp of
     * 0 (or negative) means "no timestamp" and yields the receipt time. p20+: this is
     * the `t` on note.on/note.off, so a grader can judge when the key went down rather
     * than when the WebView got round to reading the socket.
     */
    static long midiEventEpochMs(long midiNanos, long nowEpochMs, long nowNanos) {
        if (midiNanos <= 0) return nowEpochMs;
        return nowEpochMs - Math.round((nowNanos - midiNanos) / 1e6);
    }

    /** JSON for an outbound note. `t` (epoch ms) is omitted when eventEpochMs <= 0. */
    static String buildNote(String type, int note, int velocity, long eventEpochMs) {
        try {
            JSONObject o = new JSONObject();
            o.put("type", type);
            o.put("note", note);
            if (velocity >= 0) o.put("velocity", velocity);
            if (eventEpochMs > 0) o.put("t", eventEpochMs);
            return o.toString();
        } catch (JSONException e) {
            return null;
        }
    }
}
