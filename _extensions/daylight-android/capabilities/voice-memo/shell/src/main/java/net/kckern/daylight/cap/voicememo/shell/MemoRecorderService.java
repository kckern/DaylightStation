package net.kckern.daylight.cap.voicememo.shell;

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
import net.kckern.daylight.cap.voicememo.shell.RecorderMachine.Action;
import net.kckern.daylight.cap.voicememo.shell.RecorderMachine.Event;

import java.io.File;
import java.security.SecureRandom;

/**
 * Records one voice memo. Installed code on purpose: a memo can be captured while
 * the payload is being swapped or is broken. It writes a file and nothing else; the
 * payload's voice-memo capability owns the queue and the upload.
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
    static final String ACTION_STOP = "net.kckern.daylight.memo.STOP";
    private static final String TAG = "Daylight-Memo";
    private static final String CHANNEL_ID = "daylight_recording";
    private static final int NOTIFICATION_ID = 31;

    /** One machine for the process: the record screen reads whether a recording is under way. */
    private static final RecorderMachine MACHINE = new RecorderMachine();

    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable cap = () -> handle(Event.CAP_REACHED);
    private final AudioManager.OnAudioFocusChangeListener onFocus = change -> {
        // A call, or another app that takes the microphone or the output: the memo ends
        // there and what was said so far is kept.
        if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) handle(Event.FOCUS_LOST);
    };
    private MediaRecorder recorder;
    private File part;
    private String memoId;
    private AudioFocusRequest focus;

    /** When the recording under way began; 0 when none is. */
    static long startedAtMs() { return MACHINE.startedAtMs(); }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_START.equals(action)) {
            // Within five seconds of being started as a foreground service, whatever follows.
            if (!goForeground()) { stopSelf(); return START_NOT_STICKY; }
            handle(Event.START);
        } else {
            // STOP, and anything else: a restart with no intent has nothing to record.
            handle(Event.STOP);
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
                    new Intent(this, MemoRecorderService.class).setAction(ACTION_STOP),
                    PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            PendingIntent show = PendingIntent.getActivity(this, 1,
                    new Intent(this, RecordActivity.class).putExtra(RecordActivity.EXTRA_SHOW, true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                    PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            Notification notification = new Notification.Builder(this, CHANNEL_ID)
                    .setContentTitle("Recording a voice memo")
                    .setContentText("Tap Stop to finish and save it")
                    .setSmallIcon(R.drawable.ic_memo_mic)
                    .setOngoing(true)
                    .setUsesChronometer(true)
                    .setWhen(System.currentTimeMillis())
                    .setContentIntent(show)
                    .addAction(new Notification.Action.Builder(null, "Stop", stop).build())
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
        File inbox = new File(getFilesDir(), MemoFiles.INBOX);
        if (!inbox.isDirectory() && !inbox.mkdirs()) {
            Log.e(TAG, "cannot create the inbox");
            return false;
        }
        // No recording is under way, so every .part here was cut off and cannot be played.
        int cutOff = MemoFiles.removeCutOff(inbox);
        if (cutOff > 0) Log.w(TAG, "removed " + cutOff + " recording(s) that were cut off");
        memoId = MemoFiles.newId(System.currentTimeMillis(), new SecureRandom().nextLong());
        part = MemoFiles.part(inbox, memoId);
        for (RecorderMachine.Profile profile : RecorderMachine.PROFILES) {
            MediaRecorder r = new MediaRecorder();
            try {
                r.setAudioSource(MediaRecorder.AudioSource.MIC);
                r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
                r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
                r.setAudioChannels(profile.channels);
                r.setAudioSamplingRate(profile.sampleRate);
                r.setAudioEncodingBitRate(profile.bitRate);
                r.setMaxDuration(RecorderMachine.MAX_DURATION_MS);
                r.setMaxFileSize(RecorderMachine.MAX_FILE_BYTES);
                r.setOnInfoListener((mr, what, extra) -> {
                    if (what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED
                            || what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_FILESIZE_REACHED) {
                        main.post(() -> handle(Event.CAP_REACHED));
                    }
                });
                r.setOnErrorListener((mr, what, extra) -> main.post(() -> handle(Event.RECORDER_ERROR)));
                r.setOutputFile(part.getPath());
                r.prepare();
                r.start();
                recorder = r;
                takeFocus();
                Log.i(TAG, "recording " + memoId + " at " + profile.sampleRate + " Hz");
                return true;
            } catch (Exception e) {
                Log.w(TAG, "the recorder did not start at " + profile.sampleRate + " Hz: " + e.getClass().getSimpleName());
                try { r.release(); } catch (RuntimeException ignored) { }
                part.delete();
            }
        }
        return false;
    }

    private void finish(Event why) {
        main.removeCallbacks(cap);
        MediaRecorder r = recorder;
        recorder = null;
        File written = part;
        part = null;
        dropFocus();
        if (r == null || written == null) return;
        long startedAt = memoStart();
        boolean stopped = true;
        try {
            r.stop();
        } catch (RuntimeException nothingCaptured) {
            stopped = false;                      // stop() throws when nothing was captured, and leaves no index
        } finally {
            try { r.release(); } catch (RuntimeException ignored) { }
        }
        long durationMs = startedAt > 0 ? System.currentTimeMillis() - startedAt : 0;
        long bytes = written.length();
        File finished = RecorderMachine.keep(stopped, durationMs, bytes) ? MemoFiles.finish(written) : null;
        if (finished == null) {
            written.delete();
            Log.i(TAG, "discarded " + memoId + " after " + why + ": " + durationMs + " ms, " + bytes + " bytes");
            return;
        }
        Log.i(TAG, "saved " + memoId + " after " + why + ": " + durationMs + " ms, " + bytes + " bytes");
        // Tell the payload now. With none loaded, its next scan of the inbox finds the file.
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
