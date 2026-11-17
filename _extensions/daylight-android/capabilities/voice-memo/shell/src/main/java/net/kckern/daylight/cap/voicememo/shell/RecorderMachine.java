package net.kckern.daylight.cap.voicememo.shell;

/**
 * What the recorder does for each thing that can happen to it. Pure: the service
 * feeds it events and performs the action it answers.
 *
 *   IDLE ──START──► STARTING ──began──► RECORDING ──any end──► IDLE
 *
 * Every end is the same end: the stop button, the notification's Stop, the tile or
 * widget tapped again, the thirty-minute cap, a call or another app taking the
 * microphone (loss of audio focus), an error from the recorder, the service being
 * destroyed. The recorder is stopped and what it wrote is kept or discarded by one
 * rule (keep).
 *
 * A recording whose process was killed leaves a .part file and no chance to run any
 * of this. That file has no index and cannot be played; it is removed the next time
 * a recording starts (MemoFiles.removeCutOff).
 */
final class RecorderMachine {
    /** The hard cap on one memo. */
    static final int MAX_DURATION_MS = 30 * 60_000;
    /** Under the intake's 26,214,400-byte limit, with room for the container. */
    static final long MAX_FILE_BYTES = 24L * 1024 * 1024;
    /** Under this a recording is a slip of the finger and is discarded. */
    static final long MIN_DURATION_MS = 1000;
    /** A second tap this soon after the first is the same tap, and does not stop the recording. */
    static final long DOUBLE_TAP_MS = 1500;

    /** AAC in an MP4 container, mono. Tried in order: the second is the one every encoder takes. */
    static final class Profile {
        final int sampleRate;
        final int bitRate;
        final int channels = 1;

        Profile(int sampleRate, int bitRate) {
            this.sampleRate = sampleRate;
            this.bitRate = bitRate;
        }
    }

    static final Profile[] PROFILES = { new Profile(16_000, 32_000), new Profile(44_100, 64_000) };

    enum Event { START, STOP, CAP_REACHED, FOCUS_LOST, RECORDER_ERROR, SERVICE_DESTROYED }

    enum Action {
        NONE,
        /** Set the recorder up and start it; then call began() or failedToBegin(). */
        BEGIN,
        /** Stop the recorder, decide on the file with keep(), stop the service. */
        FINISH,
        /** Release what was set up, delete the part file, stop the service. */
        DISCARD_AND_STOP,
        /** Nothing is recording: just stop the service. */
        STOP_SERVICE
    }

    enum Tap { START, STOP, SHOW, CLOSE }

    private enum State { IDLE, STARTING, RECORDING }

    private State state = State.IDLE;
    private long startedAtMs;

    synchronized Action on(Event event, long nowMs) {
        if (event == Event.START) {
            if (state != State.IDLE) return Action.NONE;
            state = State.STARTING;
            return Action.BEGIN;
        }
        State was = state;
        state = State.IDLE;
        startedAtMs = 0;
        if (was == State.RECORDING) return Action.FINISH;
        return was == State.STARTING ? Action.DISCARD_AND_STOP : Action.STOP_SERVICE;
    }

    /** The recorder is running. */
    synchronized void began(long nowMs) {
        if (state != State.STARTING) return;
        state = State.RECORDING;
        startedAtMs = nowMs;
    }

    /** The recorder could not be set up or started. */
    synchronized Action failedToBegin() {
        state = State.IDLE;
        startedAtMs = 0;
        return Action.DISCARD_AND_STOP;
    }

    synchronized boolean recording() { return state == State.RECORDING; }

    /** When the recording under way began; 0 when none is. */
    synchronized long startedAtMs() { return startedAtMs; }

    /**
     * Whether a finished recording is a memo. The recorder's stop writes the file's
     * index: when it failed there is none, and the file is discarded however long it is.
     */
    static boolean keep(boolean recorderStopped, long durationMs, long bytes) {
        return recorderStopped && durationMs >= MIN_DURATION_MS && bytes > 0;
    }

    /**
     * What opening the record screen does.
     *
     * @param startedAtMs      when the recording under way began; 0 when none is
     * @param fromNotification the screen was opened from the recording's own notification
     */
    static Tap tap(long startedAtMs, long nowMs, boolean fromNotification) {
        if (startedAtMs <= 0) return fromNotification ? Tap.CLOSE : Tap.START;
        if (fromNotification || nowMs - startedAtMs < DOUBLE_TAP_MS) return Tap.SHOW;
        return Tap.STOP;
    }
}
