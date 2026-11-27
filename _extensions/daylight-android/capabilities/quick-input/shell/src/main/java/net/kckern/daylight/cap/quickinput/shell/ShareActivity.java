package net.kckern.daylight.cap.quickinput.shell;

import net.kckern.daylight.shellkit.DaylightTheme;
import net.kckern.daylight.shellkit.DaylightTheme.Radius;
import net.kckern.daylight.shellkit.DaylightTheme.Type;
import android.app.Activity;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import net.kckern.daylight.api.PayloadPort;
import net.kckern.daylight.shellkit.ShellStart;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Daylight in Android's share sheet: text or a link shared from any app goes to the
 * household's share router, which works out what it is (a video link plays on a screen).
 *
 * Exported, with no permission: the share sheet starts it for whatever app the owner is
 * sharing from, and no permission exists that only the share sheet holds. It takes
 * plain text only, sends nothing until the owner taps where it should go, and writes
 * the text into the same private quick-input queue a typed note uses (destinations
 * whose id is "share" or "share-…", in the payload's settings; the first is the
 * default and is the big button). The queue sends it with this install's identity,
 * retries it and shows it in Capture status, like any capture.
 */
public class ShareActivity extends Activity {
    /** How long a cold start may take before the payload answers. */
    /** Once the payload is up, how long its account binding and answer may take. */
    static final long READY_WAIT_MS = 8000;

    private final ExecutorService worker = Executors.newSingleThreadExecutor(task -> {
        Thread thread = new Thread(task, "Daylight-share");
        thread.setDaemon(true);
        return thread;
    });
    private final Handler main = new Handler(Looper.getMainLooper());
    private LinearLayout layout;
    private TextView status;
    private String text;
    private boolean sending;

    /** One place a share may go. */
    static final class Target {
        final String id;
        final String label;
        Target(String id, String label) { this.id = id; this.label = label; }
    }

    /** The text a share carries, within the intake's limit, or null when there is none. */
    static String sharedText(String extraText, String subject) {
        String body = extraText != null && !extraText.trim().isEmpty() ? extraText
                : (subject != null && !subject.trim().isEmpty() ? subject : null);
        if (body == null) return null;
        if (TextDraft.body(body) != null) return body;
        // Over the limit: keep the start (a link comes first or near it).
        int take = TextDraft.accepted(0, body, 0, body.length(), TextDraft.MAX_BYTES);
        String cut = body.substring(0, take);
        return TextDraft.body(cut) == null ? null : cut;
    }

    /** The payload's answer, read: the share destinations in order, the default first. */
    static List<Target> targets(String answer) {
        List<Target> out = new ArrayList<>();
        try {
            JSONObject reply = new JSONObject(answer);
            if (!reply.optBoolean("ok")) return out;
            JSONArray list = reply.optJSONArray("targets");
            for (int i = 0; list != null && i < list.length(); i++) {
                JSONObject t = list.optJSONObject(i);
                String id = t == null ? null : MemoFiles.dest(t.optString("id"));
                String label = t == null ? null : MemoFiles.label(t.optString("label"));
                if (id != null) out.add(new Target(id, label == null ? id : label));
            }
        } catch (org.json.JSONException unreadable) {
            out.clear();
        }
        return out;
    }

    @Override protected void attachBaseContext(android.content.Context base) {
        super.attachBaseContext(DaylightTheme.wrap(base));
    }

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        net.kckern.daylight.shellkit.UiTelemetry.install(this);
        if (Build.VERSION.SDK_INT >= 33) setRecentsScreenshotEnabled(false);
        Intent intent = getIntent();
        boolean plainText = intent != null && Intent.ACTION_SEND.equals(intent.getAction())
                && intent.getType() != null && intent.getType().startsWith("text/");
        text = plainText ? sharedText(stringExtra(intent, Intent.EXTRA_TEXT), stringExtra(intent, Intent.EXTRA_SUBJECT)) : null;
        if (text == null) {
            say("Nothing to share");
            finish();
            return;
        }
        build();
        ShellStart.ensure(this);
        worker.execute(this::loadTargets);
    }

    private static String stringExtra(Intent intent, String name) {
        CharSequence value = intent.getCharSequenceExtra(name);
        return value == null ? null : value.toString();
    }

    private void build() {
        layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        int pad = CaptureUi.dp(this, 20);
        layout.setPadding(pad, pad, pad, pad / 2);
        DaylightTheme t = DaylightTheme.of(this);
        layout.setBackgroundColor(t.background);
        TextView heading = CaptureUi.text(this, "Share to Daylight", Type.HEADLINE, t.ink, true);
        if (android.os.Build.VERSION.SDK_INT >= 28) heading.setAccessibilityHeading(true); // API 28; the phone floor is 26
        layout.addView(heading);
        status = CaptureUi.text(this, "Getting ready…", Type.BODY, t.inkMuted, false);
        layout.addView(status);
        setContentView(layout);
        getWindow().setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    /**
     * Waits for the payload (a cold start loads it, as long as the loader gives it), then for
     * its account binding, then asks where shares may go. "Starting Daylight…" shows meanwhile.
     */
    private void loadTargets() {
        if (!net.kckern.daylight.shellkit.PayloadReady.now(MemoFiles.PORT).ready()) {
            main.post(() -> { if (!isFinishing()) status.setText(net.kckern.daylight.shellkit.PayloadReady.STARTING); });
        }
        net.kckern.daylight.shellkit.PayloadReady.Answer up = net.kckern.daylight.shellkit.PayloadReady.await(MemoFiles.PORT);
        if (!up.ready()) {
            main.post(() -> {
                if (isFinishing() || isDestroyed()) return;
                status.setText(up.state == net.kckern.daylight.shellkit.PayloadReady.State.FAILED ? up.words()
                        : "Daylight is still starting. Share again in a moment.");
                addClose();
            });
            return;
        }
        long until = System.currentTimeMillis() + READY_WAIT_MS;
        String owner = null;
        while (owner == null && System.currentTimeMillis() < until) {
            owner = CaptureScope.current();
            if (owner == null) {
                try { Thread.sleep(150); } catch (InterruptedException stop) { return; }
            }
        }
        List<Target> found = new ArrayList<>();
        if (owner != null) {
            try {
                String request = new JSONObject().put("op", "share-targets").put("owner", owner).toString();
                found = targets(PayloadPort.named(MemoFiles.PORT).call(request, Math.max(1000, until - System.currentTimeMillis())));
            } catch (Exception unavailable) {
                found = new ArrayList<>();
            }
        }
        String selectedOwner = owner;
        List<Target> selected = found;
        main.post(() -> show(selectedOwner, selected));
    }

    private void show(String owner, List<Target> targets) {
        if (isFinishing() || isDestroyed()) return;
        if (owner == null) {
            status.setText("Daylight is not set up on this phone yet.");
            addClose();
            return;
        }
        if (targets.isEmpty()) {
            status.setText("Sharing has no destination on this phone.");
            addClose();
            return;
        }
        status.setText(preview(text));
        // The default is the point of the screen: one big button. The others are below it.
        Target first = targets.get(0);
        TextView play = CaptureUi.pill(this, "Send to " + first.label, true);
        play.setOnClickListener(v -> send(owner, first));
        LinearLayout.LayoutParams big = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        big.topMargin = CaptureUi.dp(this, 16);
        layout.addView(play, big);
        for (int i = 1; i < targets.size(); i++) {
            Target other = targets.get(i);
            TextView option = CaptureUi.pill(this, other.label, false);
            option.setOnClickListener(v -> send(owner, other));
            LinearLayout.LayoutParams row = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            row.topMargin = CaptureUi.dp(this, 8);
            layout.addView(option, row);
        }
        addClose();
    }

    private void addClose() {
        TextView close = CaptureUi.link(this, "Cancel");
        close.setOnClickListener(v -> finish());
        layout.addView(close, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    }

    /** The first line of what is shared, short: enough to see it is the right thing. */
    static String preview(String shared) {
        String line = shared.trim().split("\\R", 2)[0];
        return line.length() > 80 ? line.substring(0, 79) + "…" : line;
    }

    private void send(String owner, Target target) {
        if (sending || !CaptureScope.currentIs(owner)) return;
        sending = true;
        status.setText("Sending to " + target.label + "…");
        String body = text;
        worker.execute(() -> {
            boolean queued = false;
            try {
                CaptureDraftStore store = new CaptureDraftStore(getFilesDir(), owner);
                CaptureDraftStore.Draft draft = store.create(target.id, target.label, CaptureDraftStore.Kind.TEXT);
                store.writeText(draft.id, new String(TextDraft.body(body), StandardCharsets.UTF_8));
                queued = store.sendForCurrentOwner(draft.id);
                if (queued) CaptureFiles.tellPayload(this);
            } catch (IOException | RuntimeException failed) {
                queued = false;
            }
            boolean ok = queued;
            main.post(() -> {
                if (ok) {
                    say("Sent to " + target.label);
                    finish();
                } else {
                    sending = false;
                    status.setText("Could not queue the share. Try again.");
                }
            });
        });
    }

    @Override protected void onDestroy() {
        worker.shutdownNow();
        super.onDestroy();
    }

    private void say(String message) {
        Toast.makeText(getApplicationContext(), message, Toast.LENGTH_SHORT).show();
    }
}
