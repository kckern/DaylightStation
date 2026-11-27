package net.kckern.daylight.cap.notifications.shell;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import net.kckern.daylight.api.PayloadPort;
import net.kckern.daylight.shellkit.DaylightTheme;
import net.kckern.daylight.shellkit.LauncherCaptureShortcut;
import net.kckern.daylight.shellkit.PayloadReady;
import net.kckern.daylight.shellkit.ShellStart;

/**
 * Receives a link (daylight://, or an https link of the household site), hands it to
 * the payload and performs the answer. Every launcher shortcut, tile and widget button
 * comes through here too.
 *
 * Rule for editing this file: forward, do not decide. Which links are allowed is the
 * payload's decision (the notifications capability); this class reads the intent's
 * action and data and nothing else (see LinkRequest), and can do three things with the
 * answer (see LinkAnswer).
 *
 * Cold start: Android may create this activity in a process with no payload. It is
 * visible, so it may start the shell service. It keeps the link and waits for the port
 * to attach for as long as the loader gives a payload to start (PayloadReady), showing a
 * small "Starting Daylight… · <what was tapped>" card with Cancel, and runs the link the
 * moment the payload is there. Warm, nothing is shown before the answer. Only when the
 * loader gave up, or the whole start deadline passed, does it say so.
 */
public class LinkActivity extends Activity {
    private static final String TAG = "Daylight-Link";
    /** A warm tap answers before this; only a tap still waiting after it shows the card. */
    private static final long CARD_AFTER_MS = 300;
    // Port dispatch and its posted front effect keep the order Android delivered the taps.
    private static final java.util.concurrent.ExecutorService LINKS =
            java.util.concurrent.Executors.newSingleThreadExecutor(r -> new Thread(r, "Daylight-link"));

    private volatile boolean cancelled;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (savedInstanceState != null) {
            // Recreated (a rotation): the first instance's wait still holds the link and runs it once.
            finish();
            return;
        }
        Intent intent = getIntent();
        final String link = intent == null ? null : LinkRequest.accept(intent.getAction(), intent.getDataString());
        if (link == null) {
            Log.w(TAG, "ignored an intent that is not a link");
            finish();
            return;
        }
        ShellStart.ensure(this);
        final boolean capture = LauncherCaptureShortcut.isCaptureLink(link);
        final String port = capture ? LauncherCaptureShortcut.PORT : PayloadPort.LINKS;
        final android.os.Handler main = new android.os.Handler(android.os.Looper.getMainLooper());
        final Runnable card = () -> { if (!isFinishing()) showStarting(LinkLabel.of(link)); };
        if (!PayloadReady.now(port).ready()) main.postDelayed(card, CARD_AFTER_MS);
        LINKS.execute(() -> {
            LinkAnswer answer;
            long began = android.os.SystemClock.elapsedRealtime();
            try {
                PayloadReady.Answer ready = PayloadReady.await(port);
                if (cancelled) {
                    Log.i(TAG, "link cancelled while Daylight started");
                    answer = LinkAnswer.of("{\"ok\":true,\"effect\":\"none\"}");
                } else if (ready.state == PayloadReady.State.FAILED) {
                    Log.w(TAG, "the payload did not start: " + ready.reason);
                    answer = LinkAnswer.failedToStart();
                } else if (!ready.ready()) {
                    answer = LinkAnswer.notReady();
                } else if (capture) {
                    String id = LauncherCaptureShortcut.authorizedId(this, link);
                    answer = id == null ? LinkAnswer.of("{\"ok\":false,\"message\":\"Add this shortcut again from your launcher.\"}")
                            : LinkAnswer.of(PayloadPort.named(port).call(id, 1000));
                } else {
                    answer = LinkAnswer.of(PayloadPort.named(port).call(LinkRequest.body(link), 1000));
                }
            } catch (PayloadPort.NotReadyException noPayload) {
                answer = LinkAnswer.notReady();
            } catch (Throwable failed) {
                // The payload is replaceable code; whatever it throws must not take this activity down.
                Log.w(TAG, "the payload failed on a link: " + failed.getClass().getSimpleName());
                answer = LinkAnswer.of("{\"ok\":false}");
            }
            long waited = android.os.SystemClock.elapsedRealtime() - began;
            if (waited > CARD_AFTER_MS) Log.i(TAG, "link ran after a " + waited + " ms wait for the payload");
            final LinkAnswer result = answer;
            main.post(() -> {
                main.removeCallbacks(card);
                perform(result);
                if (!isFinishing()) finish();
            });
        });
    }

    /** The card along the bottom: what was tapped, that it is kept, and Cancel. */
    private void showStarting(String what) {
        DaylightTheme t = DaylightTheme.of(this);
        int pad = Math.round(16 * getResources().getDisplayMetrics().density);
        FrameLayout root = new FrameLayout(this);
        LinearLayout box = new LinearLayout(this);
        box.setGravity(Gravity.CENTER_VERTICAL);
        box.setPadding(pad, pad, pad / 2, pad);
        box.setBackground(t.round(t.surfaceVariant, DaylightTheme.Radius.LARGE));
        box.setElevation(pad / 2f);
        TextView words = t.text(this, PayloadReady.STARTING + " · " + what, DaylightTheme.Type.BODY, t.ink, false);
        words.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        box.addView(words, new LinearLayout.LayoutParams(0, -2, 1));
        TextView cancel = t.text(this, "Cancel", DaylightTheme.Type.LABEL, t.primary, true);
        cancel.setPadding(pad, pad / 2, pad / 2, pad / 2);
        cancel.setBackground(t.pressable(null));
        cancel.setOnClickListener(v -> { cancelled = true; finish(); });
        box.addView(cancel);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM);
        lp.setMargins(pad, pad, pad, pad * 2);
        root.addView(box, lp);
        setContentView(root);
    }

    /** Back while the card shows is Cancel: the link is not run. */
    @Override public void onBackPressed() {
        cancelled = true;
        super.onBackPressed();
    }

    private void perform(LinkAnswer answer) {
        try {
            if (answer.kind == LinkAnswer.Kind.TOAST && !answer.message.isEmpty()) {
                Toast.makeText(getApplicationContext(), answer.message, Toast.LENGTH_SHORT).show();
            } else if (answer.kind == LinkAnswer.Kind.FRONT) {
                // This app's own launcher activity, asked of the package manager by this
                // app's own package name. Nothing from the link or the answer is in the intent.
                Intent front = getPackageManager().getLaunchIntentForPackage(getPackageName());
                Intent page = new Intent().setClassName(this, "net.kckern.daylight.cap.webviewhost.shell.KioskActivity");
                if (page.resolveActivity(getPackageManager()) != null) front = page;
                if (front != null) startActivity(front.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT));
            }
        } catch (RuntimeException e) {
            Log.w(TAG, "could not perform the link's effect: " + e.getClass().getSimpleName());
        }
    }
}
