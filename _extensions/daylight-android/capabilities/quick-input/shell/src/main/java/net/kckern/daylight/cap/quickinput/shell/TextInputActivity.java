package net.kckern.daylight.cap.quickinput.shell;

import net.kckern.daylight.shellkit.DaylightTheme;
import net.kckern.daylight.shellkit.DaylightTheme.Radius;
import net.kckern.daylight.shellkit.DaylightTheme.Type;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.text.Editable;
import android.text.InputFilter;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Edits a destination's private text draft until Send or confirmed Discard. */
public class TextInputActivity extends Activity {
    private static final ExecutorService DISK = Executors.newSingleThreadExecutor(task -> {
        Thread thread = new Thread(task, "Daylight-text-drafts");
        thread.setDaemon(true);
        return thread;
    });

    private final CaptureScopeWait bindingWait = new CaptureScopeWait();
    private TextView checkingLine;
    private final DraftDiscard confirmation = new DraftDiscard();
    private AlertDialog discardDialog;
    private CaptureDraftStore store;
    private TextDraftWriter writer;
    private Bundle deferredState;
    private boolean completed;
    private boolean loading;
    private boolean busy;
    private boolean finishingDraft;
    private String owner;
    private String dest;
    private String label;
    private EditText field;
    private TextView counter;
    private TextView cancel;
    private TextView send;

    @Override protected void attachBaseContext(android.content.Context base) {
        super.attachBaseContext(DaylightTheme.wrap(base));
    }

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // The screen's own heading names it; the dialog's title would say it a second time.
        requestWindowFeature(android.view.Window.FEATURE_NO_TITLE);
        net.kckern.daylight.shellkit.UiTelemetry.install(this);
        setFinishOnTouchOutside(false);
        if (Build.VERSION.SDK_INT >= 33) setRecentsScreenshotEnabled(false);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE
                | WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        owner = getIntent().getStringExtra(CaptureScope.EXTRA);
        if (savedInstanceState != null && CaptureScope.valid(owner) && CaptureScope.current() == null) {
            deferredState = savedInstanceState;
            TextView checking = new TextView(this);
            checking.setText(net.kckern.daylight.api.PayloadPort.named(MemoFiles.PORT).ready()
                    ? CaptureScopeWait.CHECKING : net.kckern.daylight.shellkit.PayloadReady.STARTING);
            checkingLine = checking;
            setContentView(checking);
        } else {
            open(getIntent(), savedInstanceState);
        }
    }

    @Override protected void onResume() {
        super.onResume();
        if (isFinishing()) return;
        if (deferredState != null) {
            bindingWait.await(this, owner, () -> {
                Bundle selected = deferredState;
                deferredState = null;
                open(getIntent(), selected);
            }, this::bindingUnavailable, checkingLine);
        } else if (!CaptureScope.currentIs(owner)) {
            bindingUnavailable();
        }
    }

    @Override protected void onPause() {
        bindingWait.cancel();
        super.onPause();
    }

    private void bindingUnavailable() {
        say(bindingWait.why());
        finish();
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (completed || isFinishing() || finishingDraft || deferredState != null) return;
        String nextOwner = intent.getStringExtra(CaptureScope.EXTRA);
        if (!CaptureScope.currentIs(nextOwner)) return;
        String nextDest = MemoFiles.dest(intent.getStringExtra(MemoFiles.EXTRA_DEST));
        if (nextDest == null || nextOwner.equals(owner) && nextDest.equals(dest)) return;
        invalidateDiscard();
        if (writer == null || !nextOwner.equals(owner)) {
            if (writer != null && !busy) writer.complete(() -> { }, error -> {
                if (error != null) reportWriteFailure(error);
            });
            setIntent(intent);
            open(intent, null);
            return;
        }
        if (busy) return;
        TextDraftWriter selected = writer;
        setBusy(true);
        selected.complete(() -> { }, error -> runOnUiThread(() -> {
            if (isDestroyed() || isFinishing() || writer != selected) return;
            if (error != null) {
                setBusy(false);
                say("Could not save the draft");
                return;
            }
            setIntent(intent);
            open(intent, null);
        }));
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        if (deferredState != null) {
            state.putString("draft", deferredState.getString("draft"));
            state.putString("text", deferredState.getString("text"));
            state.putLong("revision", deferredState.getLong("revision"));
            return;
        }
        if (writer == null) return;
        state.putString("draft", writer.id);
        if (!finishingDraft && CaptureScope.currentIs(owner)) {
            state.putString("text", field.getText().toString());
            state.putLong("revision", writer.revision());
        }
    }

    private void open(Intent intent, Bundle state) {
        String selectedOwner = intent.getStringExtra(CaptureScope.EXTRA);
        String selectedDest = MemoFiles.dest(intent.getStringExtra(MemoFiles.EXTRA_DEST));
        if (selectedDest == null || !CaptureScope.currentIs(selectedOwner)) {
            bindingUnavailable();
            return;
        }
        owner = selectedOwner;
        dest = selectedDest;
        String selectedLabel = MemoFiles.label(intent.getStringExtra(MemoFiles.EXTRA_LABEL));
        label = selectedLabel == null ? "Quick input" : selectedLabel;
        CaptureDraftStore selectedStore = new CaptureDraftStore(getFilesDir(), owner);
        store = selectedStore;
        writer = null;
        setTitle(label);
        build();
        setBusy(true);
        getWindow().setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        String restoredId = state == null ? null : state.getString("draft");
        String restoredBody = state == null ? null : state.getString("text");
        TextDraft.Snapshot saved = restoredBody == null ? null
                : new TextDraft.Snapshot(restoredBody, state.getLong("revision"));
        DISK.execute(() -> {
            try {
                CaptureDraftStore.Draft stored = restoredId == null
                        ? selectedStore.latest(selectedDest, CaptureDraftStore.Kind.TEXT) : selectedStore.get(restoredId);
                if (restoredId != null && (stored == null || stored.kind != CaptureDraftStore.Kind.TEXT
                        || !selectedDest.equals(stored.dest))) {
                    // An earlier Android state can outlive a completed Send or Discard.
                    runOnUiThread(() -> {
                        if (store == selectedStore && !isDestroyed()) finish();
                    });
                    return;
                }
                CaptureDraftStore.Draft draft = stored != null ? stored
                        : selectedStore.create(selectedDest, selectedLabel == null ? "Quick input" : selectedLabel,
                                CaptureDraftStore.Kind.TEXT);
                TextDraft.Snapshot selected = selectedStore.restoreText(draft.id, saved);
                runOnUiThread(() -> {
                    if (isDestroyed() || isFinishing() || store != selectedStore) return;
                    if (!CaptureScope.currentIs(selectedOwner) || selected == null) {
                        finish();
                        return;
                    }
                    label = draft.label;
                    setTitle(label);
                    writer = new TextDraftWriter(selectedStore, DISK, draft.id, selected.revision, this::reportWriteFailure);
                    loading = true;
                    field.setText(selected.body);
                    field.setSelection(field.length());
                    loading = false;
                    setBusy(false);
                });
            } catch (IOException error) {
                runOnUiThread(() -> {
                    if (store != selectedStore || isDestroyed() || isFinishing()) return;
                    say("Could not open the draft");
                    finish();
                });
            }
        });
    }

    private void build() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        int pad = CaptureUi.dp(this, 20);
        layout.setPadding(pad, pad, pad, pad / 2);
        DaylightTheme t = DaylightTheme.of(this);
        layout.setBackgroundColor(t.background);

        TextView heading = CaptureUi.text(this, label, Type.HEADLINE, t.ink, true);
        if (android.os.Build.VERSION.SDK_INT >= 28) heading.setAccessibilityHeading(true); // API 28; the phone floor is 26
        layout.addView(heading);

        field = new EditText(this);
        field.setId(R.id.quick_input_text);
        field.setSaveEnabled(false);
        field.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        field.setMinLines(4);
        field.setMaxLines(10);
        field.setGravity(Gravity.TOP | Gravity.START);
        field.setHint("Type here");
        t.style(field, Type.BODY, t.ink, false);
        field.setHintTextColor(t.inkMuted);
        field.setBackground(t.round(t.surface, Radius.MEDIUM));
        field.setPadding(CaptureUi.dp(this, 16), CaptureUi.dp(this, 14), CaptureUi.dp(this, 16), CaptureUi.dp(this, 14));
        // The intake's limit, held as the text is typed: what does not fit is not taken.
        field.setFilters(new InputFilter[] { (source, start, end, into, dstart, dend) -> {
            int kept = TextDraft.utf8Length(into, 0, dstart) + TextDraft.utf8Length(into, dend, into.length());
            int take = TextDraft.accepted(kept, source, start, end, TextDraft.MAX_BYTES);
            return take == end - start ? null : source.subSequence(start, start + take);
        } });
        counter = CaptureUi.text(this, "", Type.CAPTION, t.inkMuted, false);
        field.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) { }
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) { }
            @Override public void afterTextChanged(Editable s) {
                counter.setText(TextDraft.counter(TextDraft.utf8Length(s, 0, s.length())));
                if (!loading && !busy && writer != null && CaptureScope.currentIs(owner)) writer.edit(s.toString());
            }
        });
        LinearLayout.LayoutParams fieldParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        fieldParams.topMargin = CaptureUi.dp(this, 12);
        layout.addView(field, fieldParams);
        layout.addView(counter);

        // The point of the screen: one full-width filled Send at the bottom (D10). Back keeps
        // the draft; Discard is a quiet link under it.
        layout.addView(new android.view.View(this), new LinearLayout.LayoutParams(0, 0, 1));
        send = CaptureUi.primary(this, "Send");
        send.setOnClickListener(v -> send());
        LinearLayout.LayoutParams sendParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        sendParams.topMargin = CaptureUi.dp(this, 12);
        layout.addView(send, sendParams);
        cancel = CaptureUi.link(this, "Discard draft");
        cancel.setOnClickListener(v -> confirmDiscard());
        layout.addView(cancel, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        setContentView(layout);
        field.requestFocus();
    }

    private void reportWriteFailure(IOException error) {
        runOnUiThread(() -> {
            if (!isDestroyed() && !isFinishing()) counter.setText("Could not save the draft. Try again.");
        });
    }

    private void setBusy(boolean value) {
        busy = value;
        field.setEnabled(!value);
        cancel.setEnabled(!value);
        send.setEnabled(!value);
    }

    private void send() {
        if (completed || busy || writer == null || !CaptureScope.currentIs(owner)) return;
        byte[] body = TextDraft.body(field.getText().toString());
        if (body == null) {
            say("Nothing to send");
            return;
        }
        TextDraftWriter selected = writer;
        CaptureDraftStore selectedStore = store;
        String selectedOwner = owner;
        finishDraft(selected, () -> {
            if (!CaptureScope.currentIs(selectedOwner)) throw new IOException("The draft belongs to another account");
            selectedStore.writeText(selected.id, new String(body, StandardCharsets.UTF_8));
            if (!selectedStore.sendForCurrentOwner(selected.id)) throw new IOException("Draft cannot be sent");
            CaptureFiles.tellPayload(this);
        }, () -> CaptureUi.sent(this), "Could not queue the draft. Check it and try again.");
    }

    private void confirmDiscard() {
        if (completed || busy || writer == null || !CaptureScope.currentIs(owner)) return;
        if (field.length() == 0) {
            discard(writer, false);
            return;
        }
        invalidateDiscard();
        TextDraftWriter selected = writer;
        DraftDiscard.Request requested = confirmation.ask(selected.id);
        discardDialog = new AlertDialog.Builder(this, DaylightTheme.alert())
                .setTitle("Discard this text draft?")
                .setNegativeButton("Keep draft", null)
                .setPositiveButton("Discard draft", (dialog, which) -> {
                    if (writer == selected && CaptureScope.currentIs(owner) && confirmation.confirm(requested, writer.id)) {
                        discard(selected, true);
                    }
                }).show();
    }

    private void invalidateDiscard() {
        confirmation.invalidate();
        if (discardDialog != null) {
            discardDialog.dismiss();
            discardDialog = null;
        }
    }

    private void discard(TextDraftWriter selected, boolean confirmed) {
        CaptureDraftStore selectedStore = store;
        String selectedOwner = owner;
        finishDraft(selected, () -> {
            if (!CaptureScope.currentIs(selectedOwner)) throw new IOException("The draft belongs to another account");
            if (selectedStore.get(selected.id) != null && !selectedStore.discard(selected.id, confirmed)) {
                throw new IOException("Discard needs confirmation");
            }
        }, null, "Could not discard the draft");
    }

    private void finishDraft(TextDraftWriter selected, TextDraftWriter.Action action, Runnable onComplete, String errorMessage) {
        invalidateDiscard();
        finishingDraft = true;
        setBusy(true);
        selected.complete(action, error -> runOnUiThread(() -> {
            if (isDestroyed() || isFinishing() || writer != selected) return;
            if (error != null) {
                finishingDraft = false;
                setBusy(false);
                say(errorMessage);
                return;
            }
            completed = true;
            if (onComplete != null) onComplete.run();
            finish();
        }));
    }

    /**
     * Back keeps what was typed and leaves: the draft is saved as it is edited, so a dialog asking
     * "discard?" protected nothing. An empty draft is simply dropped. Throwing text away is the
     * explicit "Discard draft" link.
     */
    @Override public void onBackPressed() {
        if (completed || busy || writer == null || !CaptureScope.currentIs(owner)) { super.onBackPressed(); return; }
        if (field.length() == 0) { discard(writer, false); return; }
        finishDraft(writer, () -> { }, () -> say("Draft kept"), "Could not save the draft");
    }

    @Override protected void onDestroy() {
        bindingWait.cancel();
        invalidateDiscard();
        super.onDestroy();
    }

    private void say(String message) {
        Toast.makeText(getApplicationContext(), message, Toast.LENGTH_SHORT).show();
    }
}
