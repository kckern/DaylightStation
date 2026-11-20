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

/** Edits a destination's private text draft until Send or confirmed Discard. */
public class TextInputActivity extends Activity {
    private CaptureDraftStore store;
    private CaptureDraftStore.Draft draft;
    private boolean completed;
    private boolean loading;
    private String dest;
    private String label;
    private EditText field;
    private TextView counter;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        store = new CaptureDraftStore(getFilesDir());
        setFinishOnTouchOutside(false);
        if (Build.VERSION.SDK_INT >= 33) setRecentsScreenshotEnabled(false);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE
                | WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        open(getIntent(), savedInstanceState == null ? null : savedInstanceState.getString("draft"));
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (completed || isFinishing() || dest.equals(MemoFiles.dest(intent.getStringExtra(MemoFiles.EXTRA_DEST)))) return;
        if (!save(field.getText().toString())) return;
        setIntent(intent);
        open(intent, null);
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        if (draft != null) state.putString("draft", draft.id);
    }

    private void open(Intent intent, String restoredId) {
        dest = MemoFiles.dest(intent.getStringExtra(MemoFiles.EXTRA_DEST));
        label = MemoFiles.label(intent.getStringExtra(MemoFiles.EXTRA_LABEL));
        if (dest == null) {
            finish();
            return;
        }
        if (label == null) label = "Quick input";
        try {
            draft = restoredId == null ? store.latest(dest, CaptureDraftStore.Kind.TEXT) : store.get(restoredId);
            String text = draft != null && draft.hasContent()
                    ? new String(Files.readAllBytes(draft.file.toPath()), StandardCharsets.UTF_8) : "";
            if (draft != null) label = draft.label;
            setTitle(label);
            build();
            loading = true;
            field.setText(text);
            field.setSelection(field.length());
            loading = false;
            getWindow().setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        } catch (IOException e) {
            say("Could not open the draft");
            finish();
        }
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
                if (!loading && !completed) save(s.toString());
            }
        });
        layout.addView(field, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        counter = new TextView(this);
        counter.setTextSize(12);
        layout.addView(counter);

        LinearLayout buttons = new LinearLayout(this);
        buttons.setOrientation(LinearLayout.HORIZONTAL);
        buttons.setGravity(Gravity.END);
        Button cancel = new Button(this);
        cancel.setText("Cancel");
        cancel.setOnClickListener(v -> confirmDiscard());
        buttons.addView(cancel);
        Button send = new Button(this);
        send.setText("Send");
        send.setOnClickListener(v -> send());
        buttons.addView(send);
        layout.addView(buttons, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        setContentView(layout);
        field.requestFocus();
    }

    private boolean save(String value) {
        if (draft == null && value.isEmpty()) return true;
        try {
            if (draft == null) draft = store.create(dest, label, CaptureDraftStore.Kind.TEXT);
            store.writeText(draft.id, value);
            return true;
        } catch (IOException e) {
            say("Could not save the draft");
            return false;
        }
    }

    private void send() {
        if (completed) return;
        byte[] body = TextDraft.body(field.getText().toString());
        if (body == null) {
            say("Nothing to send");
            return;
        }
        if (!save(new String(body, StandardCharsets.UTF_8))) return;
        try {
            if (!store.send(draft.id)) return;
            completed = true;
            CaptureFiles.tellPayload();
            say("Queued for " + label);
            finish();
        } catch (IOException e) {
            say("Could not queue the draft. Check it and try again.");
        }
    }

    private void confirmDiscard() {
        if (completed) return;
        if (field.length() == 0 && (draft == null || !draft.requiresDiscardConfirmation())) {
            discard(false);
            return;
        }
        new AlertDialog.Builder(this)
                .setTitle("Discard this text draft?")
                .setNegativeButton("Keep draft", null)
                .setPositiveButton("Discard draft", (dialog, which) -> discard(true))
                .show();
    }

    private void discard(boolean confirmed) {
        try {
            if (draft != null && !store.discard(draft.id, confirmed)) return;
            completed = true;
            finish();
        } catch (IOException e) {
            say("Could not discard the draft");
        }
    }

    @Override public void onBackPressed() { confirmDiscard(); }

    private void say(String message) {
        Toast.makeText(getApplicationContext(), message, Toast.LENGTH_SHORT).show();
    }
}
