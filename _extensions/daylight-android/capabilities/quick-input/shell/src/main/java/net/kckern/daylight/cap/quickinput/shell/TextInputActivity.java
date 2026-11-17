package net.kckern.daylight.cap.quickinput.shell;

import android.app.Activity;
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

import java.io.File;
import java.security.SecureRandom;

/**
 * The one screen of a typed quick input: a field, Send and Cancel. Nothing leaves the
 * screen until Send, which writes the text to a file of this app and hands it to the
 * upload queue like a recording; from there it survives the process being killed and
 * is sent when the backend can be reached.
 *
 * Not exported. It is opened by the payload when a keyed input link arrives, which only
 * this app's own surfaces can build. It is not shown over the lock screen. What is typed
 * is not logged, not put in a notice and not kept anywhere but the field until Send.
 *
 * Rule for editing this file: perform, do not decide. What may be typed and what is
 * sent is TextDraft's; what the file is called and where it goes is CaptureFiles'.
 */
public class TextInputActivity extends Activity {
    private String dest;
    private String label;
    private EditText field;
    private TextView counter;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        dest = MemoFiles.dest(getIntent() == null ? null : getIntent().getStringExtra(MemoFiles.EXTRA_DEST));
        label = MemoFiles.label(getIntent() == null ? null : getIntent().getStringExtra(MemoFiles.EXTRA_LABEL));
        if (dest == null) {
            // Started with nothing to send to: only this app can start it, so this is a mistake of its own.
            finish();
            return;
        }
        if (label == null) label = "Quick input";
        setTitle(label);
        // The task is kept out of the recents list (the manifest), and from Android 13 the
        // system takes no picture of this window for it either. Screenshots are not blocked.
        if (Build.VERSION.SDK_INT >= 33) setRecentsScreenshotEnabled(false);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE
                | WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        build();
        getWindow().setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        CaptureFiles.sweep(new File(getFilesDir(), CaptureFiles.INBOX), System.currentTimeMillis());
    }

    private void build() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (20 * getResources().getDisplayMetrics().density);
        layout.setPadding(pad, pad, pad, pad / 2);

        field = new EditText(this);
        // An id, so Android keeps the draft when it builds the screen again (a rotation).
        field.setId(R.id.quick_input_text);
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
            @Override public void afterTextChanged(Editable s) { counter.setText(TextDraft.counter(TextDraft.utf8Length(s, 0, s.length()))); }
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
        cancel.setOnClickListener(v -> close());
        buttons.addView(cancel);
        Button send = new Button(this);
        send.setText("Send");
        send.setOnClickListener(v -> send());
        buttons.addView(send);
        layout.addView(buttons, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        setContentView(layout);
        field.requestFocus();
    }

    private void send() {
        byte[] body = TextDraft.body(field.getText().toString());
        if (body == null) {
            Toast.makeText(getApplicationContext(), "Nothing to send", Toast.LENGTH_SHORT).show();
            return;
        }
        String id = MemoFiles.newId(System.currentTimeMillis(), new SecureRandom().nextLong());
        File written = CaptureFiles.write(new File(getFilesDir(), CaptureFiles.INBOX), id, dest, CaptureFiles.TEXT, body);
        if (written == null) {
            // The draft stays in the field: nothing was queued and nothing is lost.
            Toast.makeText(getApplicationContext(), "Could not save it. Nothing was sent.", Toast.LENGTH_LONG).show();
            return;
        }
        CaptureFiles.tellPayload();
        Toast.makeText(getApplicationContext(), "Sending to " + label, Toast.LENGTH_SHORT).show();
        close();
    }

    /** The field is emptied before the window goes, so no picture of the screen taken on the way out holds the draft. */
    private void close() {
        if (field != null) field.setText("");
        finish();
    }
}
