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
 * of this. What becomes of it is MemoRecovery's: an Ogg file plays up to where it
 * stops and becomes a memo; an MP4 without its index is kept aside. Nothing is deleted.
 *
 * The container is chosen so that a cut-off recording is still a memo, and so that
 * one recording is one memo: Ogg/Opus where the phone can write it (Android 10 and
 * later). Before that only MP4 exists, which is unplayable without the index written
 * at the end, so the recording is written as five-minute segments, each a whole file
 * and a memo of its own; a kill then loses at most the last five minutes.
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

    /** How a recording is written. */
    enum Format { OGG_OPUS, MP4_SEGMENTS }

    /** MediaRecorder writes Ogg/Opus from Android 10 (API 29). */
    static Format format(int sdk) { return sdk >= 29 ? Format.OGG_OPUS : Format.MP4_SEGMENTS; }

    /** How long one MP4 segment is. Each is a memo of the day's allowance, so they are few. */
    static final int SEGMENT_MS = 5 * 60_000;

    /**
     * The file size at which a segment ends. The recorder rotates on size, not on time:
     * this is five minutes of sound at the bit rate, plus a twentieth for the container.
     */
    static long segmentBytes(int bitRate) {
        long audio = (long) bitRate / 8 * (SEGMENT_MS / 1000);
        return audio + audio / 20;
    }

    /** Opus in an Ogg container, mono. 16 kHz is speech; 48 kHz is what every Opus encoder takes. */
    static final Profile[] OPUS_PROFILES = { new Profile(16_000, 32_000), new Profile(48_000, 64_000) };

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
        return keep(Format.MP4_SEGMENTS, recorderStopped, durationMs, bytes);
    }

    /**
     * As above, by container. An Ogg file needs no index: what was written plays, so a
     * recorder whose stop failed still left a memo.
     */
    static boolean keep(Format format, boolean recorderStopped, long durationMs, long bytes) {
        if (durationMs < MIN_DURATION_MS || bytes <= 0) return false;
        return format == Format.OGG_OPUS || recorderStopped;
    }

    /**
     * What the record screen does when Android builds it again (the phone was turned,
     * the theme or the font size changed) instead of the owner opening it. It never
     * acts on the intent a second time: that intent started the recording, and read
     * again more than a moment later it would stop and save it.
     *
     * @param startedAtMs      when the recording under way began; 0 when none is
     * @param askingPermission the permission dialog was up when the screen was rebuilt
     */
    static Tap reopened(long startedAtMs, boolean askingPermission) {
        if (startedAtMs > 0 || askingPermission) return Tap.SHOW;
        return Tap.CLOSE;
    }

    /** What opening the record screen does: {@link #tap} the first time, {@link #reopened} when it is rebuilt. */
    static Tap open(boolean rebuilt, long startedAtMs, long nowMs, boolean fromNotification, boolean askingPermission) {
        return rebuilt ? reopened(startedAtMs, askingPermission) : tap(startedAtMs, nowMs, fromNotification);
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
