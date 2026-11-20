package net.kckern.daylight.cap.quickinput.shell;

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
import java.nio.file.Files;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Edits a destination's private text draft until Send or confirmed Discard. */
public class TextInputActivity extends Activity {
    private static final ExecutorService DISK = Executors.newSingleThreadExecutor(task -> {
        Thread thread = new Thread(task, "Daylight-text-drafts");
        thread.setDaemon(true);
        return thread;
    });

    private final DraftDiscard confirmation = new DraftDiscard();
    private AlertDialog discardDialog;
    private CaptureDraftStore store;
    private TextDraftWriter writer;
    private boolean completed;
    private boolean loading;
    private boolean busy;
    private boolean finishingDraft;
    private String owner;
    private String dest;
    private String label;
    private EditText field;
    private TextView counter;
    private Button cancel;
    private Button send;

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setFinishOnTouchOutside(false);
        if (Build.VERSION.SDK_INT >= 33) setRecentsScreenshotEnabled(false);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE
                | WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        open(getIntent(), savedInstanceState);
    }

    @Override protected void onResume() {
        super.onResume();
        if (!isFinishing() && !CaptureScope.currentIs(owner)) finish();
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (completed || isFinishing() || finishingDraft) return;
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
        if (writer == null) return;
        state.putString("draft", writer.id);
        if (!finishingDraft && CaptureScope.currentIs(owner)) state.putString("text", field.getText().toString());
    }

    private void open(Intent intent, Bundle state) {
        String selectedOwner = intent.getStringExtra(CaptureScope.EXTRA);
        String selectedDest = MemoFiles.dest(intent.getStringExtra(MemoFiles.EXTRA_DEST));
        if (selectedDest == null || !CaptureScope.currentIs(selectedOwner)) {
            finish();
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
                boolean hasFile = draft.file.isFile();
                String text = hasFile ? new String(Files.readAllBytes(draft.file.toPath()), StandardCharsets.UTF_8)
                        : restoredBody == null ? "" : restoredBody;
                runOnUiThread(() -> {
                    if (isDestroyed() || isFinishing() || store != selectedStore) return;
                    if (!CaptureScope.currentIs(selectedOwner)) {
                        finish();
                        return;
                    }
                    label = draft.label;
                    setTitle(label);
                    writer = new TextDraftWriter(selectedStore, DISK, draft.id, this::reportWriteFailure);
                    loading = true;
                    field.setText(text);
                    field.setSelection(field.length());
                    loading = false;
                    setBusy(false);
                    if (!hasFile && !text.isEmpty()) writer.edit(text);
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
        int pad = (int) (20 * getResources().getDisplayMetrics().density);
        layout.setPadding(pad, pad, pad, pad / 2);

        field = new EditText(this);
        field.setId(R.id.quick_input_text);
        field.setSaveEnabled(false);
        field.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        field.setMinLines(3);
        field.setMaxLines(10);
        field.setGravity(Gravity.TOP | Gravity.START);
        field.setHint("Type here");
        // The intake's limit, held as the text is typed: what does not fit is not taken.
        field.setFilters(new InputFilter[] { (source, start, end, into, dstart, dend) -> {
            int kept = TextDraft.utf8Length(into, 0, dstart) + TextDraft.utf8Length(into, dend, into.length());
            int take = TextDraft.accepted(kept, source, start, end, TextDraft.MAX_BYTES);
            return take == end - start ? null : source.subSequence(start, start + take);
        } });
        field.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) { }
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) { }
            @Override public void afterTextChanged(Editable s) {
                counter.setText(TextDraft.counter(TextDraft.utf8Length(s, 0, s.length())));
                if (!loading && !busy && writer != null && CaptureScope.currentIs(owner)) writer.edit(s.toString());
            }
        });
        layout.addView(field, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        counter = new TextView(this);
        counter.setTextSize(12);
        layout.addView(counter);

        LinearLayout buttons = new LinearLayout(this);
        buttons.setOrientation(LinearLayout.HORIZONTAL);
        buttons.setGravity(Gravity.END);
        cancel = new Button(this);
        cancel.setText("Cancel");
        cancel.setOnClickListener(v -> confirmDiscard());
        buttons.addView(cancel);
        send = new Button(this);
        send.setText("Send");
        send.setOnClickListener(v -> send());
        buttons.addView(send);
        layout.addView(buttons, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
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
        String destinationLabel = label;
        String selectedOwner = owner;
        finishDraft(selected, () -> {
            if (!CaptureScope.currentIs(selectedOwner)) throw new IOException("The draft belongs to another account");
            selectedStore.writeText(selected.id, new String(body, StandardCharsets.UTF_8));
            if (!selectedStore.sendForCurrentOwner(selected.id)) throw new IOException("Draft cannot be sent");
            CaptureFiles.tellPayload();
        }, "Queued for " + destinationLabel, "Could not queue the draft. Check it and try again.");
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
        discardDialog = new AlertDialog.Builder(this)
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

    private void finishDraft(TextDraftWriter selected, TextDraftWriter.Action action, String message, String errorMessage) {
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
            if (message != null) say(message);
            finish();
        }));
    }

    @Override public void onBackPressed() { confirmDiscard(); }

    @Override protected void onDestroy() {
        invalidateDiscard();
        super.onDestroy();
    }

    private void say(String message) {
        Toast.makeText(getApplicationContext(), message, Toast.LENGTH_SHORT).show();
    }
}
