package net.kckern.daylight.cap.quickinput.shell;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import net.kckern.daylight.api.PayloadPort;
import net.kckern.daylight.shellkit.ShellStart;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Reads the phone's recoverable capture status without relying on notifications. */
public final class CaptureStatusActivity extends Activity {
    private static final String ID = "capture-id";
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Runnable refresh = this::refresh;
    private LinearLayout content;
    private TextView summary;
    private String owner;
    private String rendered = "";
    private boolean active;
    private boolean loading;
    private boolean acting;

    static void open(Context context, String owner, String id) {
        Intent intent = new Intent(context, CaptureStatusActivity.class)
                .putExtra(CaptureScope.EXTRA, owner).putExtra(ID, id);
        context.startActivity(intent);
    }

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        owner = state == null ? getIntent().getStringExtra(CaptureScope.EXTRA)
                : state.getString(CaptureScope.EXTRA);
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(CaptureUi.PAPER);
        scroll.setFillViewport(true);
        getWindow().setStatusBarColor(CaptureUi.PAPER);
        getWindow().setNavigationBarColor(CaptureUi.PAPER);
        getWindow().getDecorView().setSystemUiVisibility(android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
                | android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        LinearLayout layout = column();
        int padding = CaptureUi.dp(this, 20);
        layout.setPadding(padding, padding, padding, padding);
        TextView heading = CaptureUi.text(this, "Captures", 28, CaptureUi.INK, true);
        if (android.os.Build.VERSION.SDK_INT >= 28) heading.setAccessibilityHeading(true); // API 28; the phone floor is 26
        layout.addView(heading);
        summary = CaptureUi.text(this, "Loading captures…", 16, CaptureUi.INK, false);
        summary.setAlpha(0.75f);
        layout.addView(summary);
        content = column();
        layout.addView(content);
        TextView done = CaptureUi.pill(this, "Done", true);
        done.setOnClickListener(v -> finish());
        LinearLayout.LayoutParams doneParams = new LinearLayout.LayoutParams(-1, -2);
        doneParams.topMargin = CaptureUi.dp(this, 20);
        layout.addView(done, doneParams);
        TextView health = CaptureUi.link(this, "Open Health");
        health.setOnClickListener(v -> request("health", null));
        layout.addView(health, new LinearLayout.LayoutParams(-1, -2));
        scroll.addView(layout);
        setContentView(scroll);
        ShellStart.ensure(this);
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        state.putString(CaptureScope.EXTRA, owner);
        super.onSaveInstanceState(state);
    }

    @Override protected void onStart() {
        super.onStart();
        active = true;
        refresh();
    }

    @Override protected void onStop() {
        active = false;
        main.removeCallbacks(refresh);
        clear("Loading captures…");
        super.onStop();
    }

    @Override protected void onDestroy() {
        worker.shutdownNow();
        super.onDestroy();
    }

    private void clear(String message) {
        summary.setText(message);
        content.removeAllViews();
        rendered = "";
    }

    private void refresh() {
        if (!active) return;
        String current = CaptureScope.current();
        if (owner == null && current != null) owner = current;
        if (!CaptureScope.currentIs(owner)) {
            clear(current == null ? "Waiting for the capture account…" : "This capture belongs to another account.");
        } else if (!loading && !acting) {
            request("status", null);
        }
        main.removeCallbacks(refresh);
        main.postDelayed(refresh, 1000);
    }

    private void request(String operation, String id) {
        String selected = owner;
        if (acting || !CaptureScope.currentIs(selected)) return;
        boolean query = "status".equals(operation);
        if (query) loading = true;
        else acting = true;
        net.kckern.daylight.shellkit.ShellStart.ensure(this);
        worker.execute(() -> {
            JSONObject response = null;
            try {
                JSONObject request = new JSONObject().put("op", operation).put("owner", selected).put("id", id);
                response = new JSONObject(PayloadPort.named(MemoFiles.PORT).call(request.toString(), 6000));
            } catch (Exception unavailable) {
                // The next refresh can read from the restarted payload.
            }
            JSONObject answer = response;
            main.post(() -> {
                if (query) loading = false;
                else acting = false;
                if (!active || isFinishing()) return;
                if (!CaptureScope.currentIs(selected)) {
                    clear("Capture account changed.");
                } else if (answer == null || !answer.optBoolean("ok")) {
                    if ("status".equals(operation)) clear("Capture status is unavailable. Checking again…");
                    else Toast.makeText(this, "This action is unavailable. Check capture status and try again.", Toast.LENGTH_SHORT).show();
                } else if ("status".equals(operation)) {
                    render(answer.optJSONArray("inputs"));
                } else if ("front".equals(answer.optString("effect"))) {
                    Intent page = new Intent().setClassName(this, "net.kckern.daylight.cap.webviewhost.shell.KioskActivity");
                    if (page.resolveActivity(getPackageManager()) != null) {
                        startActivity(page.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT));
                    }
                } else if ("toast".equals(answer.optString("effect"))) {
                    Toast.makeText(this, answer.optString("message"), Toast.LENGTH_SHORT).show();
                } else if ("replace".equals(operation)) {
                    finish();
                }
            });
        });
    }

    private void render(JSONArray rows) {
        if (rows == null || rows.length() == 0) {
            clear("No captures for this account.");
            return;
        }
        String next = rows.toString();
        if (next.equals(rendered)) return;
        rendered = next;
        summary.setText("");
        content.removeAllViews();
        String focused = getIntent().getStringExtra(ID);
        for (int pass = 0; pass < 2; pass++) {
            for (int i = 0; i < rows.length(); i++) {
                JSONObject row = rows.optJSONObject(i);
                if (row == null) continue;
                String id = row.optString("id");
                if ((pass == 0) != id.equals(focused)) continue;
                content.addView(card(row, id));
            }
        }
    }

    /** One capture: where it went, when, what became of it, and the one thing to do about it. */
    private LinearLayout card(JSONObject row, String id) {
        LinearLayout card = column();
        int pad = CaptureUi.dp(this, 16);
        card.setPadding(pad, pad, pad, pad);
        card.setBackground(CaptureUi.round(this, android.graphics.Color.WHITE, 16));
        card.addView(CaptureUi.text(this, row.optString("destination"), 18, CaptureUi.INK, true));
        long capturedAt = row.optLong("recordedAtMs");
        if (capturedAt > 0) {
            TextView when = CaptureUi.text(this, java.text.DateFormat.getDateTimeInstance(
                    java.text.DateFormat.SHORT, java.text.DateFormat.SHORT).format(new java.util.Date(capturedAt)),
                    13, CaptureUi.INK, false);
            when.setAlpha(0.6f);
            card.addView(when);
        }
        String message = row.optString("message");
        String action = row.optString("action");
        boolean attention = "Replace capture".equals(action) || "Retry".equals(action);
        TextView state = CaptureUi.text(this, message, 15, attention ? 0xff9a4a00 : CaptureUi.GREEN, true);
        state.setPadding(0, CaptureUi.dp(this, 6), 0, 0);
        card.addView(state);
        // The payload's action names are what it understands; the words on the button are plain.
        String label = "Replace capture".equals(action) ? "Replace" : "Retry".equals(action) ? "Try again"
                : "View in Health".equals(action) ? "View" : null;
        if (label != null) {
            TextView button = CaptureUi.pill(this, label, attention);
            button.setOnClickListener(v -> request("Replace capture".equals(action) ? "replace"
                    : "Retry".equals(action) ? "retry" : "view", id));
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
            params.topMargin = CaptureUi.dp(this, 10);
            card.addView(button, params);
        }
        LinearLayout.LayoutParams outer = new LinearLayout.LayoutParams(-1, -2);
        outer.topMargin = CaptureUi.dp(this, 12);
        card.setLayoutParams(outer);
        return card;
    }

    private LinearLayout column() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        return layout;
    }

    private TextView text(LinearLayout column, String message, int size) {
        TextView view = new TextView(this);
        view.setText(message);
        view.setTextSize(size);
        column.addView(view);
        return view;
    }

    private void button(LinearLayout column, String label, Runnable action) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        button.setOnClickListener(view -> action.run());
        column.addView(button);
    }
}
