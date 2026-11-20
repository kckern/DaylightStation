package net.kckern.daylight.cap.quickinput.shell;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.KeyguardManager;
import android.content.Intent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.ColorStateList;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.Window;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.Chronometer;
import android.widget.LinearLayout;
import android.widget.ImageButton;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.IOException;

/** Captures, reviews and explicitly sends private phone voice drafts. */
public class RecordActivity extends Activity {
    /** Set by the recording's notification: show the screen, do not treat the open as a tap. */
    static final String EXTRA_SHOW = "show";
    private static final int REQUEST_PERMISSIONS = 1;
    private static final String PREFS = "daylight_memo";
    private static final String ASKED_NOTIFICATIONS = "asked_notifications";
    static final String NOTIFICATIONS_OFF = "Notifications are off for Daylight. "
            + "You can send or cancel this recording here.";

    private final Handler main = new Handler(Looper.getMainLooper());
    private CaptureDraftStore store;
    private CaptureDraftStore.Draft draft;
    private TextView status;
    private TextView hint;
    private Chronometer clock;
    private Button stop;
    private Button resume;
    private Button discard;
    private MediaPlayer player;
    private String destination;
    private String destinationLabel = "Journal";
    private boolean asking;
    private boolean waitingForMic;
    private boolean beginOnResume;
    private boolean resumed;
    private boolean requested;
    private boolean seenRecording;
    private boolean sending;
    private boolean completed;
    private final Runnable watch = this::refresh;
    private final BroadcastReceiver screenOff = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            waitingForMic = beginOnResume = false;
            pauseCapture();
        }
    };

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        setFinishOnTouchOutside(false);
        if (Build.VERSION.SDK_INT >= 33) setRecentsScreenshotEnabled(false);
        store = new CaptureDraftStore(getFilesDir());
        registerReceiver(screenOff, new IntentFilter(Intent.ACTION_SCREEN_OFF));
        if (savedInstanceState != null) {
            asking = savedInstanceState.getBoolean("asking");
            waitingForMic = savedInstanceState.getBoolean("mic");
            beginOnResume = savedInstanceState.getBoolean("begin");
        }
        open(getIntent(), savedInstanceState == null ? null : savedInstanceState.getString("draft"),
                savedInstanceState == null);
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        state.putBoolean("asking", asking);
        state.putBoolean("mic", waitingForMic);
        state.putBoolean("begin", beginOnResume);
        if (draft != null) state.putString("draft", draft.id);
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (completed || isFinishing()) return;
        boolean notification = intent.getBooleanExtra(EXTRA_SHOW, false);
        String target = MemoFiles.dest(intent.getStringExtra(MemoFiles.EXTRA_DEST));
        if (notification) {
            String shown = intent.getStringExtra(MemoRecorderService.EXTRA_DRAFT);
            if (shown == null || draft != null && draft.id.equals(shown)) return;
        } else if (CaptureDraftStore.sameDestination(target, destination, true)) {
            return;
        }
        pauseCapture();
        stopPlayback();
        waitingForMic = beginOnResume = requested = seenRecording = sending = false;
        main.removeCallbacks(watch);
        setIntent(intent);
        open(intent, null, false);
    }

    private void open(Intent intent, String restoredId, boolean autoStart) {
        destination = MemoFiles.dest(intent.getStringExtra(MemoFiles.EXTRA_DEST));
        String label = MemoFiles.label(intent.getStringExtra(MemoFiles.EXTRA_LABEL));
        destinationLabel = label == null ? "Journal" : label;
        draft = null;
        try {
            store.recoverAudio(MemoRecorderService.activeId(), MemoRecorderService::playable);
            String notificationId = intent.getStringExtra(MemoRecorderService.EXTRA_DRAFT);
            if (restoredId != null || notificationId != null) {
                draft = store.get(restoredId != null ? restoredId : notificationId);
            } else {
                CaptureDraftStore.Draft active = store.get(MemoRecorderService.activeId());
                if (active != null && CaptureDraftStore.sameDestination(active.dest, destination, true)) draft = active;
                if (draft == null) draft = store.latest(destination, CaptureDraftStore.Kind.OPUS);
            }
        } catch (IOException e) {
            say("Could not open the draft");
        }
        if (draft != null) {
            destination = draft.dest;
            destinationLabel = draft.label;
        }
        setTitle(destinationLabel);
        build();
        if (draft == null && intent.getBooleanExtra(EXTRA_SHOW, false)) {
            finish();
            return;
        }
        if (draft == null && autoStart && MemoRecorderService.activeId() == null) beginOnResume = true;
        if (resumed) refresh();
    }

    @Override protected void onResume() {
        super.onResume();
        resumed = true;
        if (beginOnResume) {
            beginOnResume = false;
            if (!asking) start();
        }
        refresh();
    }

    @Override protected void onPause() {
        resumed = false;
        if (!asking) pauseCapture();
        stopPlayback();
        main.removeCallbacks(watch);
        super.onPause();
    }

    @Override protected void onStop() {
        // Home and lock finalize capture even if a permission interstitial is visible.
        pauseCapture();
        if (!isChangingConfigurations()) {
            waitingForMic = false;
            beginOnResume = false;
        }
        super.onStop();
    }

    private void pauseCapture() {
        if (completed || draft == null || sending || (!requested && !active())) return;
        try { service(MemoRecorderService.ACTION_PAUSE, false); }
        catch (RuntimeException unavailable) {
            if (active()) stopService(new Intent(this, MemoRecorderService.class));
        }
    }

    private boolean active() {
        return draft != null && draft.id.equals(MemoRecorderService.activeId())
                && MemoRecorderService.startedAtMs() > 0;
    }

    private void service(String action, boolean foreground) {
        Intent intent = new Intent(this, MemoRecorderService.class).setAction(action)
                .putExtra(MemoRecorderService.EXTRA_DRAFT, draft.id);
        if (foreground) startForegroundService(intent);
        else startService(intent);
    }

    private void start() {
        if (completed || asking || active() || requested || isFinishing()) return;
        if (getSystemService(KeyguardManager.class).isKeyguardLocked()) return;
        if (MemoRecorderService.activeId() != null) {
            say("Another memo is being finalized. Try again in a moment.");
            return;
        }
        boolean mic = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
        boolean notifications = Build.VERSION.SDK_INT < 33
                || checkSelfPermission(PermissionAsk.NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        String[] permissions = PermissionAsk.toRequest(Build.VERSION.SDK_INT, mic, notifications,
                prefs.getBoolean(ASKED_NOTIFICATIONS, false));
        if (permissions.length == 0) {
            if (!notifications) hint.setText(NOTIFICATIONS_OFF);
            if (mic) begin();
            return;
        }

        // Wait until the foreground permission interaction is complete before using the mic.
        if (PermissionAsk.asksForNotifications(permissions)) {
            prefs.edit().putBoolean(ASKED_NOTIFICATIONS, true).apply();
        }
        waitingForMic = true;
        asking = true;
        status.setText("Waiting for permission…");
        resume.setEnabled(false);
        requestPermissions(permissions, REQUEST_PERMISSIONS);
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQUEST_PERMISSIONS) return;
        boolean waiting = waitingForMic && !completed && !isFinishing() && !isDestroyed();
        waitingForMic = asking = false;
        if (!waiting) {
            refresh();
            return;
        }
        boolean granted = PermissionAsk.micGranted(permissions, grantResults,
                checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED);
        if (RecorderMachine.canBeginAfterPermission(waiting, granted)) {
            if (resumed) start();
            else beginOnResume = true;
        } else {
            say("No microphone permission. Nothing was recorded.");
            refresh();
        }
    }

    private void begin() {
        if (!resumed || !hasWindowFocus()) {
            beginOnResume = true;
            return;
        }
        try {
            if (draft == null) {
                CaptureDraftStore.Kind kind = RecorderMachine.format(Build.VERSION.SDK_INT) == RecorderMachine.Format.OGG_OPUS
                        ? CaptureDraftStore.Kind.OPUS : CaptureDraftStore.Kind.AAC;
                draft = store.create(destination, destinationLabel, kind);
            }
            requested = true;
            service(MemoRecorderService.ACTION_START, true);
            refresh();
            String requestedId = draft.id;
            main.postDelayed(() -> {
                if (draft != null && draft.id.equals(requestedId) && requested && !active()) {
                    requested = false;
                    refresh();
                }
            }, 3500);
        } catch (IOException | RuntimeException refused) {
            requested = false;
            refresh();
            say("Could not start recording");
        }
    }

    @Override public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (!hasFocus || !resumed || !beginOnResume || asking) return;
        beginOnResume = false;
        start();
    }

    private void refresh() {
        main.removeCallbacks(watch);
        if (completed || isFinishing()) return;
        if (active()) {
            if (!seenRecording) {
                long elapsed = System.currentTimeMillis() - MemoRecorderService.startedAtMs();
                clock.setBase(SystemClock.elapsedRealtime() - Math.max(0, elapsed));
                clock.start();
            }
            seenRecording = true;
            status.setText("Recording");
            stop.setEnabled(!sending);
            resume.setEnabled(false);
            main.postDelayed(watch, 200);
            return;
        }
        if (seenRecording) {
            requested = seenRecording = false;
            clock.stop();
        }
        if (draft != null && sending) {
            try {
                if (store.get(draft.id) == null) {
                    finish();
                    return;
                }
            } catch (IOException e) {
                say("Could not check the draft");
            }
            sending = false;
        }
        boolean ready = draft != null && draft.hasContent();
        boolean interrupted = draft != null && draft.interruption().isFile();
        status.setText(ready ? "Private voice draft"
                : interrupted ? "Recording interrupted. The audio could not be played."
                : requested ? "Starting…" : asking ? "Waiting for permission…" : "Ready to record");
        stop.setEnabled(ready);
        resume.setText(ready ? "Resume draft" : "Record memo");
        resume.setEnabled(!asking && !requested && !interrupted);
        discard.setEnabled(!sending);
        if (requested && resumed) main.postDelayed(watch, 200);
    }

    private void review() {
        if (draft == null || !draft.hasContent()) {
            start();
            return;
        }
        stopPlayback();
        try {
            player = new MediaPlayer();
            player.setDataSource(draft.file.getPath());
            player.setOnPreparedListener(MediaPlayer::start);
            player.setOnCompletionListener(ignored -> stopPlayback());
            player.setOnErrorListener((ignored, what, extra) -> {
                stopPlayback();
                say("Could not play this recording");
                return true;
            });
            player.prepareAsync();
            status.setText("Playing saved recording");
        } catch (IOException | RuntimeException failure) {
            stopPlayback();
            say("Could not play this recording");
        }
    }

    private void stopPlayback() {
        if (player == null) return;
        player.release();
        player = null;
    }

    private void send() {
        if (draft == null || sending || completed) return;
        sending = true;
        stopPlayback();
        try {
            if (active()) {
                service(MemoRecorderService.ACTION_SEND, false);
                refresh();
                return;
            }
            if (store.send(draft.id)) {
                CaptureFiles.tellPayload();
                say("Memo queued for sending");
                completed = true;
                finish();
            }
        } catch (IOException | RuntimeException failure) {
            say("Could not queue memo. Check the draft and try again.");
        }
        sending = false;
        refresh();
    }

    private void discardDraft(boolean confirmed) {
        try {
            if (draft != null && confirmed && (active() || requested)) {
                service(MemoRecorderService.ACTION_DISCARD, false);
            } else if (draft != null && !store.discard(draft.id, confirmed)) {
                refresh();
                return;
            }
            completed = true;
            waitingForMic = beginOnResume = asking = false;
            finish();
        } catch (IOException | RuntimeException failure) {
            say("Could not discard the draft");
        }
    }

    void confirmDiscard() {
        if (completed || sending) return;
        if (draft == null || !(requested || active() || draft.requiresDiscardConfirmation())) {
            discardDraft(false);
            return;
        }
        new AlertDialog.Builder(this)
                .setTitle("Discard this recording?")
                .setMessage("The audio will be lost.")
                .setNegativeButton("Keep draft", null)
                .setPositiveButton("Discard draft", (dialog, which) -> discardDraft(true))
                .show();
    }

    @Override public void onBackPressed() { confirmDiscard(); }

    private void say(String message) {
        Toast.makeText(getApplicationContext(), message, Toast.LENGTH_LONG).show();
    }

    private void build() {
        boolean dark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                == Configuration.UI_MODE_NIGHT_YES;
        int surface = dark ? 0xff172521 : 0xfffbfdfb;
        int ink = dark ? 0xffedf7f1 : 0xff142c24;
        int secondary = dark ? 0xffb5ccc0 : 0xff49655a;
        int control = dark ? 0xff2b4038 : 0xffe7efea;

        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(dp(24), dp(18), dp(24), dp(24));
        layout.setBackground(rounded(surface, 24));

        LinearLayout header = new LinearLayout(this);
        header.setGravity(Gravity.CENTER_VERTICAL);
        TextView title = text(destinationLabel, 23, ink);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        header.addView(title, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        ImageButton close = new ImageButton(this);
        close.setImageResource(R.drawable.ic_memo_close);
        close.setImageTintList(ColorStateList.valueOf(ink));
        close.setBackground(buttonBackground(control, 24));
        close.setContentDescription("Close recorder");
        close.setOnClickListener(v -> confirmDiscard());
        header.addView(close, new LinearLayout.LayoutParams(dp(48), dp(48)));
        layout.addView(header);

        clock = new Chronometer(this);
        clock.setTextSize(48);
        clock.setTextColor(ink);
        clock.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        clock.setFontFeatureSettings("tnum");
        clock.setGravity(Gravity.CENTER);
        clock.setPadding(0, dp(22), 0, 0);
        layout.addView(clock);

        status = text("Preparing recorder…", 15, secondary);
        status.setGravity(Gravity.CENTER);
        status.setPadding(0, dp(4), 0, dp(24));
        layout.addView(status);

        hint = text("", 14, secondary);
        layout.addView(hint);

        stop = new Button(this);
        stop.setAllCaps(false);
        stop.setText("Send memo");
        stop.setTextSize(17);
        stop.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        stop.setTextColor(Color.WHITE);
        stop.setBackground(buttonBackground(0xff165c49, 15));
        stop.setMinHeight(dp(54));
        stop.setEnabled(false);
        stop.setOnClickListener(v -> send());
        layout.addView(stop, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        resume = new Button(this);
        resume.setAllCaps(false);
        resume.setOnClickListener(v -> review());
        layout.addView(resume);

        discard = new Button(this);
        discard.setText("Discard draft");
        discard.setAllCaps(false);
        discard.setOnClickListener(v -> confirmDiscard());
        layout.addView(discard);

        ScrollView scroll = new ScrollView(this);
        scroll.setClipToOutline(true);
        scroll.setBackground(rounded(surface, 24));
        scroll.addView(layout);
        setContentView(scroll);
        Window window = getWindow();
        window.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
        window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
        window.setDimAmount(0.45f);
        int available = getResources().getConfiguration().screenWidthDp;
        window.setLayout(dp(Math.min(440, available - 32)), WindowManager.LayoutParams.WRAP_CONTENT);
    }

    private TextView text(String value, int size, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        return view;
    }

    private GradientDrawable rounded(int color, int radius) {
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(color);
        shape.setCornerRadius(dp(radius));
        return shape;
    }

    private RippleDrawable buttonBackground(int color, int radius) {
        return new RippleDrawable(ColorStateList.valueOf(0x24889990), rounded(color, radius), null);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override
    protected void onDestroy() {
        unregisterReceiver(screenOff);
        main.removeCallbacksAndMessages(null);
        stopPlayback();
        super.onDestroy();
    }
}
