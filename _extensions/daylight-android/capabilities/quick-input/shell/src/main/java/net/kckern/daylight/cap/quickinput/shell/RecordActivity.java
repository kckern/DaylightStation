package net.kckern.daylight.cap.quickinput.shell;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.Gravity;
import android.widget.Button;
import android.widget.Chronometer;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/**
 * The one screen of a voice memo. Opening it is the owner's "record": it starts a
 * recording at once and has one button. Opened again while a memo is being recorded
 * (the tile or the widget tapped a second time) it stops and saves that memo.
 *
 * Not exported. It is opened by the payload when a keyed memo link arrives, which
 * only this app's own surfaces can build, and by the recording's own notification.
 * Nothing a web page can do reaches it.
 *
 * Leaving the screen does not stop the recording; the button here and the
 * notification's Stop action do.
 */
public class RecordActivity extends Activity {
    /** Set by the recording's notification: show the screen, do not treat the open as a tap. */
    static final String EXTRA_SHOW = "show";
    private static final int REQUEST_PERMISSIONS = 1;
    private static final String PREFS = "daylight_memo";
    private static final String ASKED_NOTIFICATIONS = "asked_notifications";
    /**
     * What is true with notifications off: Android then shows no recording notice in
     * the shade (the system's own list of running apps still names Daylight), and the
     * recording runs all the same. It is stopped from this screen, or by tapping the
     * memo tile, widget button or shortcut a second time. The tile and the widget do
     * not change while a memo is being recorded.
     */
    static final String NOTIFICATIONS_OFF = "Notifications are off for Daylight, so there is no recording notice. "
            + "The recording still runs. Stop it here, or tap the memo tile, widget button or shortcut again.";

    private final Handler main = new Handler(Looper.getMainLooper());
    private TextView status;
    private TextView hint;
    private boolean micWasGranted;
    private Chronometer clock;
    private Button stop;
    private boolean sawRecording;
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
        build();
        // The intent is acted on once, when the owner opened the screen. When Android
        // builds the screen again (a rotation, a theme or font change) the same intent
        // is still there; acting on it again would stop and save the recording.
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
            case STOP:
                stopAndSave();
                break;
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
            startForegroundService(new Intent(this, MemoRecorderService.class).setAction(MemoRecorderService.ACTION_START));
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
        stop.setEnabled(true);
        clock.setBase(SystemClock.elapsedRealtime() - Math.max(0, System.currentTimeMillis() - startedAtMs));
        clock.start();
    }

    private void stopAndSave() {
        try {
            startService(new Intent(this, MemoRecorderService.class).setAction(MemoRecorderService.ACTION_STOP));
            Toast.makeText(getApplicationContext(), "Memo saved", Toast.LENGTH_SHORT).show();
        } catch (RuntimeException e) {
            Toast.makeText(getApplicationContext(), "Use Stop on the notification", Toast.LENGTH_LONG).show();
        }
        finish();
    }

    private void build() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(Gravity.CENTER_HORIZONTAL);
        int pad = (int) (24 * getResources().getDisplayMetrics().density);
        layout.setPadding(pad, pad, pad, pad);

        status = new TextView(this);
        status.setTextSize(18);
        layout.addView(status);

        clock = new Chronometer(this);
        clock.setTextSize(32);
        clock.setPadding(0, pad / 2, 0, pad);
        layout.addView(clock);

        hint = new TextView(this);
        hint.setTextSize(14);
        hint.setPadding(0, 0, 0, pad / 2);
        layout.addView(hint);

        stop = new Button(this);
        stop.setText("Stop and save");
        stop.setEnabled(false);
        stop.setOnClickListener(v -> stopAndSave());
        layout.addView(stop);
        setContentView(layout);
    }

    @Override
    protected void onDestroy() {
        main.removeCallbacksAndMessages(null);
        super.onDestroy();
    }
}
