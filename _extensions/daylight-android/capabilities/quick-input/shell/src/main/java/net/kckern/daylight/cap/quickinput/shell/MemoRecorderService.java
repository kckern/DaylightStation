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
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import net.kckern.daylight.cap.quickinput.shell.RecorderMachine.Action;
import net.kckern.daylight.cap.quickinput.shell.RecorderMachine.Event;

import java.io.File;
import java.io.IOException;

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
    static final String ACTION_DISCARD = "net.kckern.daylight.memo.DISCARD";
    static final String ACTION_PAUSE = "net.kckern.daylight.memo.PAUSE";
    static final String EXTRA_DRAFT = "draft";
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
    private int latestStart;
    private static String activeId;
    private static String activeOwner;
    private static String pendingStart;
    private CaptureDraftStore store;
    private AudioFocusRequest focus;

    /** When the recording under way began; 0 when none is. */
    static long startedAtMs() { return MACHINE.startedAtMs(); }

    static String activeId() { return activeId; }

    static void allowStart(String id) { pendingStart = id; }

    static void withdrawStart(String id) {
        if (id.equals(pendingStart)) pendingStart = null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        latestStart = startId;
        String action = intent == null ? null : intent.getAction();
        String id = intent == null ? null : intent.getStringExtra(EXTRA_DRAFT);
        String owner = intent == null ? null : intent.getStringExtra(CaptureScope.EXTRA);
        if (ACTION_START.equals(action)) {
            boolean allowed = id != null && id.equals(pendingStart);
            if (allowed) pendingStart = null;
            if (MACHINE.recording()) return START_NOT_STICKY;
            activeId = id;
            activeOwner = owner;
            if (!goForeground() || !allowed || !CaptureScope.currentIs(owner)) { end(); return START_NOT_STICKY; }
            store = new CaptureDraftStore(getFilesDir(), owner);
            handle(Event.START);
        } else if (activeId != null && activeId.equals(id) && java.util.Objects.equals(activeOwner, owner)) {
            Event event = Event.SERVICE_DESTROYED;
            if (CaptureScope.currentIs(owner)) {
                if (ACTION_SEND.equals(action)) event = Event.STOP;
                if (ACTION_DISCARD.equals(action)) event = Event.CANCEL;
            }
            handle(event);
        } else {
            // A focus or screen-off event may have finalized this draft just before
            // its user's Send or confirmed Discard reached the service.
            if (id != null && CaptureScope.currentIs(owner)) completeInactiveDraft(id, action, owner);
            if (!MACHINE.recording()) end();
        }
        return START_NOT_STICKY;
    }

    private void completeInactiveDraft(String id, String action, String owner) {
        CaptureDraftStore drafts = new CaptureDraftStore(getFilesDir(), owner);
        try {
            CaptureDraftStore.Draft draft = drafts.get(id);
            if (draft == null || !draft.kind.voice()) return;
            if (ACTION_SEND.equals(action) && drafts.sendForCurrentOwner(id)) {
                CaptureFiles.tellPayload();
                say("Memo queued for sending");
            } else if (ACTION_DISCARD.equals(action)) {
                drafts.discard(id, true);
            }
        } catch (IOException error) {
            say("Could not complete the operation. Reopen the recorder to check the draft.");
        }
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
            case SAVE_DRAFT:
            case FINISH:
                finish(action == Action.FINISH);
                end();
                break;
            case DISCARD_AND_STOP:
                discard();
                if (event == Event.CANCEL) {
                    try { store.discard(activeId, true); }
                    catch (IOException failed) { say("Could not discard the draft"); }
                }
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
                    new Intent(this, MemoRecorderService.class).setAction(ACTION_PAUSE).putExtra(EXTRA_DRAFT, activeId)
                            .putExtra(CaptureScope.EXTRA, activeOwner),
                    PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            PendingIntent show = PendingIntent.getActivity(this, 1,
                    new Intent(this, RecordActivity.class).putExtra(RecordActivity.EXTRA_SHOW, true).putExtra(EXTRA_DRAFT, activeId)
                            .putExtra(CaptureScope.EXTRA, activeOwner).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                    PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            Notification notification = new Notification.Builder(this, CHANNEL_ID)
                    .setContentTitle("Recording a voice memo")
                    .setContentText("Open the recorder to send, or stop to save a draft.")
                    .setSmallIcon(R.drawable.ic_memo_mic)
                    .setOngoing(true)
                    .setUsesChronometer(true)
                    .setWhen(System.currentTimeMillis())
                    .setContentIntent(show)
                    .addAction(new Notification.Action.Builder(null, "Stop recording", stop).build())
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
        CaptureDraftStore.Draft draft;
        try { draft = store.get(activeId); }
        catch (IOException e) { return false; }
        if (draft == null || !draft.kind.voice() || draft.hasContent()) return false;
        boolean ogg = draft.kind == CaptureDraftStore.Kind.OPUS;
        File part = draft.fragment();
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
                    // MP4 gets its index when the recorder stops.
                    r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
                    r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
                    r.setMaxFileSize(RecorderMachine.MAX_FILE_BYTES);
                }
                r.setAudioChannels(profile.channels);
                r.setAudioSamplingRate(profile.sampleRate);
                r.setAudioEncodingBitRate(profile.bitRate);
                r.setOnInfoListener((mr, what, extra) -> main.post(() -> onRecorderInfo(mr, what)));
                r.setOnErrorListener((mr, what, extra) -> main.post(() -> {
                    if (mr == recorder) handle(Event.RECORDER_ERROR);
                }));
                r.setOutputFile(part.getPath());
                r.prepare();
                r.start();
                recorder = r;
                takeFocus();
                Log.i(TAG, "recording " + activeId + " at " + profile.sampleRate + " Hz");
                return true;
            } catch (Exception e) {
                Log.w(TAG, "the recorder did not start at " + profile.sampleRate + " Hz: " + e.getClass().getSimpleName());
                try { r.release(); } catch (RuntimeException ignored) { }
                // A failed start may already have written usable audio.
                if (part.length() > 0) {
                    try { store.finishAudio(activeId, MemoRecorderService::playable); }
                    catch (IOException ignored) { }
                    return false;
                }
                part.delete();
            }
        }
        return false;
    }

    /** Main thread. Preserve the draft when the recorder reaches a cap. */
    private void onRecorderInfo(MediaRecorder mr, int what) {
        if (mr != recorder) return;
        if (what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED
                || what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_FILESIZE_REACHED) {
            handle(Event.CAP_REACHED);
        }
    }

    private void finish(boolean send) {
        main.removeCallbacks(cap);
        MediaRecorder current = recorder;
        recorder = null;
        dropFocus();
        if (current == null) return;
        try { current.stop(); } catch (RuntimeException interrupted) {
            // Some Ogg files are still playable when stop fails.
        } finally {
            try { current.release(); } catch (RuntimeException ignored) { }
        }
        try {
            boolean playable = store.finishAudio(activeId, MemoRecorderService::playable);
            if (send && playable && store.sendForCurrentOwner(activeId)) {
                CaptureFiles.tellPayload();
                say("Memo queued for sending");
            } else if (!playable) {
                say("Recording interrupted. No playable audio was found. Nothing sent.");
            }
        } catch (IOException failed) {
            say("Could not complete the operation. Reopen the recorder to check the draft.");
        }
    }

    /** Require an audio sample, not just a container header. */
    static boolean playable(File file) {
        MediaExtractor extractor = new MediaExtractor();
        try {
            extractor.setDataSource(file.getPath());
            for (int index = 0; index < extractor.getTrackCount(); index++) {
                String mime = extractor.getTrackFormat(index).getString(MediaFormat.KEY_MIME);
                if (mime != null && mime.startsWith("audio/")) {
                    extractor.selectTrack(index);
                    return extractor.getSampleTime() >= 0;
                }
            }
        } catch (IOException | RuntimeException unreadable) {
            return false;
        } finally {
            extractor.release();
        }
        return false;
    }

    private void say(String message) {
        android.widget.Toast.makeText(this, message, android.widget.Toast.LENGTH_LONG).show();
    }

    private void discard() {
        main.removeCallbacks(cap);
        MediaRecorder current = recorder;
        recorder = null;
        if (current != null) { try { current.release(); } catch (RuntimeException ignored) { } }
        dropFocus();
    }

    private void end() {
        activeId = null;
        activeOwner = null;
        try { stopForeground(true); } catch (RuntimeException ignored) { }
        stopSelfResult(latestStart);
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
