package net.kckern.daylight.cap.caractions.shell;

import net.kckern.daylight.cap.quickinput.shell.RecorderMachine;
import net.kckern.daylight.cap.quickinput.shell.RecorderMachine.Action;
import net.kckern.daylight.cap.quickinput.shell.RecorderMachine.Event;

import java.util.Locale;

/**
 * The rules of a voice memo recorded through the car's microphone. Pure. The state is
 * the phone recorder's own machine (RecorderMachine): one start, every end the same
 * end, the thirty-minute cap, under a second discarded.
 *
 * What starts a recording is a tap: on the entry in the car list (TAP_ENTRY). The car
 * screen being shown, redrawn, or the car connecting is never one.
 *
 * The car delivers raw PCM: 16,000 samples a second (CarAudioRecord's
 * AUDIO_CONTENT_SAMPLING_RATE), 16-bit ("audio/l16"), one channel. The clock and the
 * encoder's timestamps are counted from the bytes read, so they cannot drift from the
 * sound.
 */
final class CarMemo {
    /** The Car API level the car's microphone needs (CarAudioRecord is @RequiresCarApi(5)). */
    static final int MIN_CAR_API = 5;
    static final int SAMPLE_RATE = 16_000;
    static final int CHANNELS = 1;
    private static final int BYTES_PER_SECOND = SAMPLE_RATE * 2 * CHANNELS;

    static final String CAR_TOO_OLD = "This car cannot record for Daylight";
    static final String NO_MIC = "Allow the microphone on the phone first";
    static final String BUSY = "A memo is already being recorded";

    /** What can happen on the car screen. */
    enum Screen { SHOWN, REFRESHED, CONNECTED, TAP_ENTRY, TAP_STOP, GONE }

    private final RecorderMachine machine = new RecorderMachine();

    /** Only a tap on the entry starts; only Stop or the screen going away ends. */
    Action on(Screen event, long nowMs) {
        switch (event) {
            case TAP_ENTRY: return machine.on(Event.START, nowMs);
            case TAP_STOP: return machine.on(Event.STOP, nowMs);
            case GONE: return machine.on(Event.SERVICE_DESTROYED, nowMs);
            default: return Action.NONE;
        }
    }

    /** The recorder's own end: the cap, an error from the car or the encoder. */
    Action ended(Event event, long nowMs) { return machine.on(event, nowMs); }

    void began(long nowMs) { machine.began(nowMs); }

    Action failedToBegin() { return machine.failedToBegin(); }

    boolean recording() { return machine.recording(); }

    /**
     * Why a recording cannot start, or null when it can.
     *
     * @param notReady the payload's reason the entry cannot record ("" when it can)
     */
    static String refusal(int carApiLevel, boolean micGranted, String notReady, boolean busy) {
        if (carApiLevel < MIN_CAR_API) return CAR_TOO_OLD;
        if (!micGranted) return NO_MIC;
        if (notReady != null && !notReady.isEmpty()) return notReady;
        if (busy) return BUSY;
        return null;
    }

    static long durationMs(long pcmBytes) { return pcmBytes * 1000 / BYTES_PER_SECOND; }

    /** The presentation time of the sample that starts at this byte. */
    static long ptsUs(long pcmBytes) { return pcmBytes * 1_000_000L / BYTES_PER_SECOND; }

    static String clock(long elapsedMs) {
        long s = Math.max(0, elapsedMs) / 1000;
        return String.format(Locale.ROOT, "Recording %d:%02d", s / 60, s % 60);
    }

    static boolean capReached(long pcmBytes, long encodedBytes) {
        return durationMs(pcmBytes) >= RecorderMachine.MAX_DURATION_MS || encodedBytes >= RecorderMachine.MAX_FILE_BYTES;
    }

    /**
     * Ogg/Opus needs the platform's Opus encoder and its Ogg writer (MediaMuxer's OGG
     * output, Android 10 and later); otherwise AAC in MP4, written as five-minute
     * segments, as the phone recorder does below Android 10.
     */
    static RecorderMachine.Format format(int sdk, boolean opusEncoder) {
        return sdk >= 29 && opusEncoder ? RecorderMachine.Format.OGG_OPUS : RecorderMachine.Format.MP4_SEGMENTS;
    }

    /** Whether an MP4 segment that began at segmentStartUs is whole at ptsUs. */
    static boolean segmentDone(long segmentStartUs, long ptsUs) {
        return ptsUs - segmentStartUs >= RecorderMachine.SEGMENT_MS * 1000L;
    }

    static String outcome(boolean kept, String label) {
        return kept ? "Saved for " + label : "Not saved: too short or nothing was heard";
    }
}
