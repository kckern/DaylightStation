package net.kckern.daylight.cap.quickinput.shell;

/**
 * What the recorder does for each thing that can happen to it. Pure: the service
 * feeds it events and performs the action it answers.
 *
 *   IDLE ──START──► STARTING ──began──► RECORDING ──any end──► IDLE
 *
 * Phone recordings finalize only on an explicit Send. Car capture uses its own
 * end-of-recording policy and inbox.
 *
 * Public for the car screen's recorder (car-actions), which records through the car's
 * microphone by these same rules into the same inbox.
 */
public final class RecorderMachine {
    /** The hard cap on one memo. */
    public static final int MAX_DURATION_MS = 30 * 60_000;
    /** Under the intake's 26,214,400-byte limit, with room for the container. */
    public static final long MAX_FILE_BYTES = 24L * 1024 * 1024;
    /** Under this a recording is a slip of the finger and is discarded. */
    public static final long MIN_DURATION_MS = 1000;

    /** How a recording is written. */
    public enum Format { OGG_OPUS, MP4_SEGMENTS }

    /** MediaRecorder writes Ogg/Opus from Android 10 (API 29). */
    public static Format format(int sdk) { return sdk >= 29 ? Format.OGG_OPUS : Format.MP4_SEGMENTS; }

    /** How long one MP4 segment is. Each is a memo of the day's allowance, so they are few. */
    public static final int SEGMENT_MS = 5 * 60_000;

    /**
     * The file size at which a segment ends. The recorder rotates on size, not on time:
     * this is five minutes of sound at the bit rate, plus a twentieth for the container.
     */
    static long segmentBytes(int bitRate) {
        long audio = (long) bitRate / 8 * (SEGMENT_MS / 1000);
        return audio + audio / 20;
    }

    /** Opus in an Ogg container, mono. 16 kHz is speech; 48 kHz is what every Opus encoder takes. */
    public static final Profile[] OPUS_PROFILES = { new Profile(16_000, 32_000), new Profile(48_000, 64_000) };

    /** AAC in an MP4 container, mono. Tried in order: the second is the one every encoder takes. */
    public static final class Profile {
        public final int sampleRate;
        public final int bitRate;
        public final int channels = 1;

        Profile(int sampleRate, int bitRate) {
            this.sampleRate = sampleRate;
            this.bitRate = bitRate;
        }
    }

    public static final Profile[] PROFILES = { new Profile(16_000, 32_000), new Profile(44_100, 64_000) };

    public enum Event { START, STOP, CANCEL, CAP_REACHED, FOCUS_LOST, RECORDER_ERROR, SERVICE_DESTROYED }

    public enum Action {
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

    enum Tap { START, SHOW, CLOSE }

    private enum State { IDLE, STARTING, RECORDING }

    private final boolean explicitSendOnly;

    public RecorderMachine() { this(false); }

    RecorderMachine(boolean explicitSendOnly) { this.explicitSendOnly = explicitSendOnly; }

    private State state = State.IDLE;
    private long startedAtMs;

    public synchronized Action on(Event event, long nowMs) {
        if (event == Event.START) {
            if (state != State.IDLE) return Action.NONE;
            state = State.STARTING;
            return Action.BEGIN;
        }
        State was = state;
        state = State.IDLE;
        startedAtMs = 0;
        if (was == State.RECORDING) {
            return event == Event.CANCEL || (explicitSendOnly && event != Event.STOP)
                    ? Action.DISCARD_AND_STOP : Action.FINISH;
        }
        return was == State.STARTING ? Action.DISCARD_AND_STOP : Action.STOP_SERVICE;
    }

    /** The recorder is running. */
    public synchronized void began(long nowMs) {
        if (state != State.STARTING) return;
        state = State.RECORDING;
        startedAtMs = nowMs;
    }

    /** The recorder could not be set up or started. */
    public synchronized Action failedToBegin() {
        state = State.IDLE;
        startedAtMs = 0;
        return Action.DISCARD_AND_STOP;
    }

    public synchronized boolean recording() { return state == State.RECORDING; }

    /** When the recording under way began; 0 when none is. */
    public synchronized long startedAtMs() { return startedAtMs; }

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
    public static boolean keep(Format format, boolean recorderStopped, long durationMs, long bytes) {
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
        return Tap.SHOW;
    }
}
