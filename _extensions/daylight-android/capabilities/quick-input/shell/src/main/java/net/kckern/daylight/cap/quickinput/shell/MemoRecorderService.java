package net.kckern.daylight.cap.quickinput.shell;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import net.kckern.daylight.api.PayloadPort;
import net.kckern.daylight.cap.quickinput.shell.RecorderMachine.Action;
import net.kckern.daylight.cap.quickinput.shell.RecorderMachine.Event;

import java.io.File;
import java.security.SecureRandom;

/**
 * Records one voice memo. Installed code on purpose: a memo can be captured while
 * the payload is being swapped or is broken. It writes a file and nothing else; the
 * payload's quick-input capability owns the queue and the upload.
 *
 * Rule for editing this file: perform, do not decide. What each event does is
 * RecorderMachine's; what a recording is called and where it goes is MemoFiles'.
 *
 * It is started only by RecordActivity, which is on screen at that moment (Android
 * allows a microphone foreground service to start only then) and is itself opened
 * only by a tap on this phone. A notification with a Stop action is up for as long
 * as it records. The log holds a memo's id, its length and its size, never its audio.
 */
public class MemoRecorderService extends Service {
    static final String ACTION_START = "net.kckern.daylight.memo.START";
    static final String ACTION_SEND = "net.kckern.daylight.memo.SEND";
    private static final String ACTION_CANCEL = "net.kckern.daylight.memo.CANCEL";
    private static final String DRAFTS = "phone-memo-drafts";
    private static final String TAG = "Daylight-Memo";
    private static final String CHANNEL_ID = "daylight_recording";
    private static final int NOTIFICATION_ID = 31;

    /** One machine for the process: the record screen reads whether a recording is under way. */
    private static final RecorderMachine MACHINE = new RecorderMachine(true);

    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable cap = () -> handle(Event.CAP_REACHED);
    private final AudioManager.OnAudioFocusChangeListener onFocus = change -> {
        // A call, or another app that takes the microphone or the output: the memo ends
        // there and what was said so far is kept.
        if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) handle(Event.FOCUS_LOST);
    };
    private MediaRecorder recorder;
    /** The file being written: the whole memo (Ogg), or its current segment (MP4). */
    private File part;
    /** MP4 only: the file handed to the recorder for the segment after this one. */
    private File nextPart;
    private RecorderMachine.Format format = RecorderMachine.Format.OGG_OPUS;
    private int segment;
    private long segmentStartMs;
    private String memoId;
    /** The id of the destination this recording is for; null for a memo with none (the journal's). */
    private String dest;
    private AudioFocusRequest focus;

    /** When the recording under way began; 0 when none is. */
    static long startedAtMs() { return MACHINE.startedAtMs(); }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_START.equals(action)) {
            // Within five seconds of being started as a foreground service, whatever follows.
            if (!goForeground()) { stopSelf(); return START_NOT_STICKY; }
            // Read only while nothing is recording: a second start does not move a recording under way.
            if (!MACHINE.recording() && recorder == null) dest = MemoFiles.dest(intent.getStringExtra(MemoFiles.EXTRA_DEST));
            handle(Event.START);
        } else {
            handle(ACTION_SEND.equals(action) ? Event.STOP : Event.CANCEL);
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        handle(Event.SERVICE_DESTROYED);
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    /** Main thread only: every caller is a lifecycle method, a handler post or a main-thread listener. */
    private void handle(Event event) {
        Action action = MACHINE.on(event, System.currentTimeMillis());
        switch (action) {
            case BEGIN:
                if (begin()) {
                    MACHINE.began(System.currentTimeMillis());
                    main.postDelayed(cap, RecorderMachine.MAX_DURATION_MS);
                } else {
                    MACHINE.failedToBegin();
                    discard();
                    end();
                }
                break;
            case FINISH:
                finish(event);
                end();
                break;
            case DISCARD_AND_STOP:
                discard();
                end();
                break;
            case STOP_SERVICE:
                end();
                break;
            default:
                break;
        }
    }

    private boolean goForeground() {
        try {
            NotificationManager manager = getSystemService(NotificationManager.class);
            manager.createNotificationChannel(new NotificationChannel(CHANNEL_ID, "Voice memo recording", NotificationManager.IMPORTANCE_LOW));
            PendingIntent stop = PendingIntent.getService(this, 0,
                    new Intent(this, MemoRecorderService.class).setAction(ACTION_CANCEL),
                    PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            PendingIntent show = PendingIntent.getActivity(this, 1,
                    new Intent(this, RecordActivity.class).putExtra(RecordActivity.EXTRA_SHOW, true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                    PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            Notification notification = new Notification.Builder(this, CHANNEL_ID)
                    .setContentTitle("Recording a voice memo")
                    .setContentText("Open the recorder to send, or cancel this recording.")
                    .setSmallIcon(R.drawable.ic_memo_mic)
                    .setOngoing(true)
                    .setUsesChronometer(true)
                    .setWhen(System.currentTimeMillis())
                    .setContentIntent(show)
                    .addAction(new Notification.Action.Builder(null, "Cancel recording", stop).build())
                    .build();
            if (Build.VERSION.SDK_INT >= 30) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
            return true;
        } catch (RuntimeException refused) {
            // Android refuses a microphone foreground service that was not started from the screen.
            Log.w(TAG, "could not become a foreground service: " + refused.getClass().getSimpleName());
            return false;
        }
    }

    private boolean begin() {
        if (checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            Log.w(TAG, "no microphone permission");
            return false;
        }
        File inbox = new File(getFilesDir(), DRAFTS);
        if (!inbox.isDirectory() && !inbox.mkdirs()) {
            Log.e(TAG, "cannot create the draft directory");
            return false;
        }
        // Interrupted phone drafts are kept outside recovery and upload paths.
        File[] interrupted = inbox.listFiles();
        if (interrupted != null) for (File draft : interrupted) if (draft.isFile()) draft.delete();
        memoId = MemoFiles.newId(System.currentTimeMillis(), new SecureRandom().nextLong());
        format = RecorderMachine.format(Build.VERSION.SDK_INT);
        segment = 0;
        segmentStartMs = memoStart();
        boolean ogg = format == RecorderMachine.Format.OGG_OPUS;
        part = ogg ? MemoFiles.part(inbox, MemoFiles.stem(memoId, dest), MemoFiles.OGG)
                : MemoFiles.part(inbox, MemoFiles.stem(MemoFiles.segmentId(memoId, segment), dest), MemoFiles.M4A);
        MemoRecovery.live(memoId);
        for (final RecorderMachine.Profile profile : ogg ? RecorderMachine.OPUS_PROFILES : RecorderMachine.PROFILES) {
            MediaRecorder r = new MediaRecorder();
            try {
                r.setAudioSource(MediaRecorder.AudioSource.MIC);
                if (ogg) {
                    // One file for the whole memo, playable up to wherever it stops.
                    r.setOutputFormat(MediaRecorder.OutputFormat.OGG);
                    r.setAudioEncoder(MediaRecorder.AudioEncoder.OPUS);
                    r.setMaxDuration(RecorderMachine.MAX_DURATION_MS);
                    r.setMaxFileSize(RecorderMachine.MAX_FILE_BYTES);
                } else {
                    // MP4 is unplayable without the index written at its end, so it is
                    // written as five-minute files. The recorder moves to the next file
                    // when this size is near; the thirty-minute cap is the timer's.
                    r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
                    r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
                    r.setMaxFileSize(RecorderMachine.MAX_FILE_BYTES);
                }
                r.setAudioChannels(profile.channels);
                r.setAudioSamplingRate(profile.sampleRate);
                r.setAudioEncodingBitRate(profile.bitRate);
                r.setOnInfoListener((mr, what, extra) -> main.post(() -> onRecorderInfo(mr, what)));
                r.setOnErrorListener((mr, what, extra) -> main.post(() -> handle(Event.RECORDER_ERROR)));
                r.setOutputFile(part.getPath());
                r.prepare();
                r.start();
                recorder = r;
                takeFocus();
                Log.i(TAG, "recording " + memoId + " as " + format + " at " + profile.sampleRate + " Hz");
                return true;
            } catch (Exception e) {
                Log.w(TAG, "the recorder did not start at " + profile.sampleRate + " Hz: " + e.getClass().getSimpleName());
                try { r.release(); } catch (RuntimeException ignored) { }
                part.delete();
            }
        }
        MemoRecovery.live(null);
        return false;
    }

    /** Main thread. The caps, and for MP4 the move from one segment file to the next. */
    private void onRecorderInfo(MediaRecorder mr, int what) {
        if (mr != recorder) return;
        if (what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED
                || what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_FILESIZE_REACHED) {
            handle(Event.CAP_REACHED);
        }
    }

    private void finish(Event why) {
        main.removeCallbacks(cap);
        MediaRecorder r = recorder;
        recorder = null;
        File written = part;
        part = null;
        dropFocus();
        if (r == null || written == null) { MemoRecovery.live(null); return; }
        long startedAt = memoStart();
        boolean stopped = true;
        try {
            r.stop();
        } catch (RuntimeException nothingCaptured) {
            stopped = false;                      // stop() throws when nothing was captured; an MP4 then has no index
        } finally {
            try { r.release(); } catch (RuntimeException ignored) { }
        }
        long now = System.currentTimeMillis();
        boolean ogg = format == RecorderMachine.Format.OGG_OPUS;
        // For a segmented recording the rule is applied to the last segment alone.
        long durationMs = now - (ogg ? startedAt : segmentStartMs);
        long bytes = written.length();
        File finished = null;
        if (RecorderMachine.keep(format, stopped, durationMs, bytes)) {
            finished = ogg ? MemoFiles.finish(written) : MemoFiles.finishSegment(written, segmentStartMs);
        }
        if (nextPart != null) { nextPart.delete(); nextPart = null; }     // handed over and never started: empty
        MemoRecovery.live(null);
        if (finished == null) {
            // A slip of the finger, or nothing captured. With earlier segments saved, only this last piece goes.
            written.delete();
            android.widget.Toast.makeText(this, "Recording was too short or could not be saved. Nothing sent.",
                    android.widget.Toast.LENGTH_LONG).show();
            Log.i(TAG, "discarded " + memoId + (ogg ? "" : " segment " + segment) + " after " + why + ": " + durationMs + " ms, " + bytes + " bytes");
            return;
        }
        Log.i(TAG, "saved " + memoId + (ogg ? "" : " segment " + segment) + " after " + why + ": " + durationMs + " ms, " + bytes + " bytes");
        File inbox = new File(getFilesDir(), MemoFiles.INBOX);
        if ((!inbox.isDirectory() && !inbox.mkdirs()) || !finished.renameTo(new File(inbox, finished.getName()))) {
            android.widget.Toast.makeText(this, "Could not queue memo. Please record it again.", android.widget.Toast.LENGTH_LONG).show();
            return;
        }
        android.widget.Toast.makeText(this, "Memo queued for sending", android.widget.Toast.LENGTH_SHORT).show();
        tellPayload();
    }

    /** Tell the payload now. With none loaded, its next scan of the inbox finds the file. */
    private static void tellPayload() {
        Thread tell = new Thread(() -> {
            try { PayloadPort.named(MemoFiles.PORT).call(MemoFiles.RECORDED, 0); }
            catch (Throwable noPayload) { /* found by the next scan */ }
        }, "Daylight-memo-tell");
        tell.setDaemon(true);
        tell.start();
    }

    /** The id is "<start ms>-<tail>". */
    private long memoStart() {
        try {
            return memoId == null ? 0 : Long.parseLong(memoId.substring(0, memoId.indexOf('-')));
        } catch (RuntimeException e) {
            return 0;
        }
    }

    private void discard() {
        main.removeCallbacks(cap);
        MediaRecorder r = recorder;
        recorder = null;
        if (r != null) { try { r.release(); } catch (RuntimeException ignored) { } }
        if (part != null) { part.delete(); part = null; }
        if (nextPart != null) { nextPart.delete(); nextPart = null; }
        MemoRecovery.live(null);
        dropFocus();
    }

    private void end() {
        try { stopForeground(true); } catch (RuntimeException ignored) { }
        stopSelf();
    }

    private void takeFocus() {
        try {
            AudioManager audio = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                    .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                    .setOnAudioFocusChangeListener(onFocus, main)
                    .build();
            audio.requestAudioFocus(focus);
        } catch (RuntimeException e) {
            Log.w(TAG, "no audio focus: " + e.getClass().getSimpleName());
        }
    }

    private void dropFocus() {
        AudioFocusRequest f = focus;
        focus = null;
        if (f == null) return;
        try { ((AudioManager) getSystemService(Context.AUDIO_SERVICE)).abandonAudioFocusRequest(f); }
        catch (RuntimeException ignored) { }
    }
}
