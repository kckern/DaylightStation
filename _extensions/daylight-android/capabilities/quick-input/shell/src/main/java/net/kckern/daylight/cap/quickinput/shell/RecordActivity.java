package net.kckern.daylight.cap.quickinput.shell;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.ColorStateList;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
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

/**
 * Records a phone memo. A second shortcut tap shows the active recording.
 * Send is the only control that submits it; leaving discards the draft.
 */
public class RecordActivity extends Activity {
    /** Set by the recording's notification: show the screen, do not treat the open as a tap. */
    static final String EXTRA_SHOW = "show";
    private static final int REQUEST_PERMISSIONS = 1;
    private static final String PREFS = "daylight_memo";
    private static final String ASKED_NOTIFICATIONS = "asked_notifications";
    static final String NOTIFICATIONS_OFF = "Notifications are off for Daylight. "
            + "You can send or cancel this recording here.";

    private final Handler main = new Handler(Looper.getMainLooper());
    private TextView status;
    private TextView hint;
    private boolean micWasGranted;
    private Chronometer clock;
    private Button stop;
    private boolean sawRecording;
    private boolean recordingRequested;
    private boolean completed;
    private String destinationLabel = "Journal";
    private final Runnable watch = new Runnable() {
        @Override public void run() {
            long startedAt = MemoRecorderService.startedAtMs();
            if (startedAt > 0) {
                if (!sawRecording) showRecording(startedAt);
            } else if (sawRecording) {
                // It ended somewhere else: the notification, the cap, a call.
                finish();
                return;
            }
            main.postDelayed(this, 500);
        }
    };

    private static final String STATE_ASKING = "asking";
    /** The permission dialog is up. Kept across a rebuild of the screen. */
    private boolean asking;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        // Where this recording goes, by its destination's label. A title and nothing more.
        String label = MemoFiles.label(getIntent() == null ? null : getIntent().getStringExtra(MemoFiles.EXTRA_LABEL));
        if (label != null) destinationLabel = label;
        setTitle(destinationLabel);
        build();
        setFinishOnTouchOutside(false);
        // The intent is acted on once, when the owner opened the screen. When Android
        // builds the screen again (a rotation, a theme or font change) the same intent
        // is still there; acting on it again would start another recording.
        boolean rebuilt = savedInstanceState != null;
        asking = rebuilt && savedInstanceState.getBoolean(STATE_ASKING, false);
        act(getIntent(), rebuilt);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        outState.putBoolean(STATE_ASKING, asking);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        act(intent, false);
    }

    private void act(Intent intent, boolean rebuilt) {
        boolean fromNotification = intent != null && intent.getBooleanExtra(EXTRA_SHOW, false);
        switch (RecorderMachine.open(rebuilt, MemoRecorderService.startedAtMs(), System.currentTimeMillis(), fromNotification, asking)) {
            case CLOSE:
                finish();
                break;
            case SHOW:
                main.removeCallbacks(watch);
                main.post(watch);
                break;
            default:
                start();
                break;
        }
    }

    /**
     * Asks for what is missing, then records. Notifications are asked for here, once,
     * in the app: never at install. Recording does not wait for that answer when the
     * microphone is already allowed.
     */
    private void start() {
        micWasGranted = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
        boolean notificationsGranted = Build.VERSION.SDK_INT < 33
                || checkSelfPermission(PermissionAsk.NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        String[] ask = PermissionAsk.toRequest(Build.VERSION.SDK_INT, micWasGranted, notificationsGranted,
                prefs.getBoolean(ASKED_NOTIFICATIONS, false));
        if (micWasGranted) begin();
        if (ask.length == 0) {
            if (!notificationsGranted) hint.setText(NOTIFICATIONS_OFF);
            return;
        }
        if (PermissionAsk.asksForNotifications(ask)) {
            prefs.edit().putBoolean(ASKED_NOTIFICATIONS, true).apply();
            hint.setText("Notifications are how Daylight tells you that a memo is waiting to upload or could not be sent.");
        }
        if (!micWasGranted) status.setText("Daylight needs the microphone to record a memo");
        asking = true;
        requestPermissions(ask, REQUEST_PERMISSIONS);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode != REQUEST_PERMISSIONS) return;
        asking = false;
        if (completed || isFinishing() || isDestroyed()) return;
        boolean notificationsOff = Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(PermissionAsk.NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED;
        hint.setText(notificationsOff ? NOTIFICATIONS_OFF : "");
        // A rebuilt screen has lost the field; the recorder itself says whether it is running.
        if (MemoRecorderService.startedAtMs() > 0) micWasGranted = true;
        if (micWasGranted) return;                  // already recording; only notifications were asked for
        if (PermissionAsk.micGranted(permissions, grantResults, false)) {
            begin();
        } else {
            Toast.makeText(getApplicationContext(), "No microphone permission: nothing was recorded", Toast.LENGTH_LONG).show();
            finish();
        }
    }

    private void begin() {
        try {
            // This screen is visible, which is what lets a microphone foreground service start.
            // The destination travels as its id; the recorder puts it in the file's name.
            recordingRequested = true;
            startForegroundService(new Intent(this, MemoRecorderService.class).setAction(MemoRecorderService.ACTION_START)
                    .putExtra(MemoFiles.EXTRA_DEST, MemoFiles.dest(getIntent() == null ? null : getIntent().getStringExtra(MemoFiles.EXTRA_DEST))));
            status.setText("Starting…");
            main.removeCallbacks(watch);
            main.post(watch);
            // The recorder says within a moment whether it is running.
            main.postDelayed(() -> {
                if (!sawRecording && MemoRecorderService.startedAtMs() == 0) {
                    Toast.makeText(getApplicationContext(), "Could not start recording", Toast.LENGTH_LONG).show();
                    finish();
                }
            }, 4000);
        } catch (RuntimeException refused) {
            Toast.makeText(getApplicationContext(), "Could not start recording", Toast.LENGTH_LONG).show();
            finish();
        }
    }

    private void showRecording(long startedAtMs) {
        sawRecording = true;
        status.setText("Recording");
        stop.setBackground(buttonBackground(0xff165c49, 15));
        stop.setTextColor(Color.WHITE);
        stop.setEnabled(true);
        clock.setBase(SystemClock.elapsedRealtime() - Math.max(0, System.currentTimeMillis() - startedAtMs));
        clock.start();
    }

    private void send() {
        if (completed || MemoRecorderService.startedAtMs() == 0) return;
        try {
            startService(new Intent(this, MemoRecorderService.class).setAction(MemoRecorderService.ACTION_SEND));
            completed = true;
            finish();
        } catch (RuntimeException e) {
            Toast.makeText(this, "Could not send. Try again or cancel.", Toast.LENGTH_LONG).show();
        }
    }

    private void discardDraft() {
        if (completed) return;
        completed = true;
        if (recordingRequested || MemoRecorderService.startedAtMs() > 0) {
            stopService(new Intent(this, MemoRecorderService.class));
        }
    }

    private void confirmDiscard() {
        if (completed) return;
        if (!recordingRequested && MemoRecorderService.startedAtMs() == 0) {
            discardDraft();
            finish();
            return;
        }
        new AlertDialog.Builder(this)
                .setTitle("Discard this recording?")
                .setMessage("The audio will be lost.")
                .setNegativeButton("Keep recording", null)
                .setPositiveButton("Discard recording", (dialog, which) -> {
                    discardDraft();
                    finish();
                }).show();
    }

    @Override public void onBackPressed() {
        confirmDiscard();
    }

    @Override protected void onStop() {
        super.onStop();
        // The permission dialog is part of this interaction. Rotation keeps the draft.
        if (!isChangingConfigurations() && !asking) {
            discardDraft();
            finish();
        }
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
        stop.setTextColor(secondary);
        stop.setBackground(rounded(control, 15));
        stop.setMinHeight(dp(54));
        stop.setEnabled(false);
        stop.setOnClickListener(v -> send());
        layout.addView(stop, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

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
        main.removeCallbacksAndMessages(null);
        super.onDestroy();
    }
}
