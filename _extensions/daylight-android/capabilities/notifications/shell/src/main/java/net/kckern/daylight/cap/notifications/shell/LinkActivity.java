package net.kckern.daylight.cap.notifications.shell;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import android.widget.Toast;

import net.kckern.daylight.api.PayloadPort;
import net.kckern.daylight.shellkit.ShellStart;
import net.kckern.daylight.shellkit.LauncherCaptureShortcut;

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
 * visible, so it may start the shell service; it then waits on the "links" port for
 * the payload to attach. Fallback when none does in time: a message, and the service
 * is left starting so the next tap works.
 */
public class LinkActivity extends Activity {
    private static final String TAG = "Daylight-Link";
    private static final long WAIT_FOR_PAYLOAD_MS = 8000;
    // Port dispatch and its posted front effect keep the order Android delivered the taps.
    private static final java.util.concurrent.ExecutorService LINKS =
            java.util.concurrent.Executors.newSingleThreadExecutor(r -> new Thread(r, "Daylight-link"));

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Intent intent = getIntent();
        final String link = intent == null ? null : LinkRequest.accept(intent.getAction(), intent.getDataString());
        if (link == null) {
            Log.w(TAG, "ignored an intent that is not a link");
            finish();
            return;
        }
        ShellStart.ensure(this);
        LINKS.execute(() -> {
            LinkAnswer answer;
            try {
                if (LauncherCaptureShortcut.isCaptureLink(link)) {
                    String id = LauncherCaptureShortcut.authorizedId(this, link);
                    answer = id == null ? LinkAnswer.of("{\"ok\":false,\"message\":\"Add this shortcut again from your launcher.\"}")
                            : LinkAnswer.of(PayloadPort.named(LauncherCaptureShortcut.PORT).call(id, WAIT_FOR_PAYLOAD_MS));
                } else {
                    answer = LinkAnswer.of(PayloadPort.named(PayloadPort.LINKS).call(LinkRequest.body(link), WAIT_FOR_PAYLOAD_MS));
                }
            } catch (PayloadPort.NotReadyException noPayload) {
                answer = LinkAnswer.notReady();
            } catch (Throwable failed) {
                // The payload is replaceable code; whatever it throws must not take this activity down.
                Log.w(TAG, "the payload failed on a link: " + failed.getClass().getSimpleName());
                answer = LinkAnswer.of("{\"ok\":false}");
            }
            final LinkAnswer result = answer;
            runOnUiThread(() -> {
                perform(result);
                finish();
            });
        });
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
