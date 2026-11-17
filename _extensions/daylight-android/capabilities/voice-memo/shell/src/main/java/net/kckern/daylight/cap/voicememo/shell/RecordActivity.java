package net.kckern.daylight.cap.voicememo.shell;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
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
    private static final int REQUEST_MIC = 1;

    private final Handler main = new Handler(Looper.getMainLooper());
    private TextView status;
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

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        build();
        act(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        act(intent);
    }

    private void act(Intent intent) {
        boolean fromNotification = intent != null && intent.getBooleanExtra(EXTRA_SHOW, false);
        switch (RecorderMachine.tap(MemoRecorderService.startedAtMs(), System.currentTimeMillis(), fromNotification)) {
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
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                    begin();
                } else {
                    status.setText("Daylight needs the microphone to record a memo");
                    requestPermissions(new String[] { Manifest.permission.RECORD_AUDIO }, REQUEST_MIC);
                }
                break;
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode != REQUEST_MIC) return;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
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
