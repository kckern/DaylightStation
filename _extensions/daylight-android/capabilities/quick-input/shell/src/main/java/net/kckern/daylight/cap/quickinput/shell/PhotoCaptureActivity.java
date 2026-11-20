package net.kckern.daylight.cap.quickinput.shell;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.io.IOException;
import java.security.SecureRandom;
import java.util.HashMap;
import java.util.Map;

/** Reviews the system camera's confirmed output before the user explicitly sends it. */
public class PhotoCaptureActivity extends Activity {
    private static final int REQUEST_CAPTURE = 1;
    private static final int REQUEST_CAMERA = 2;
    private static final int GRANT = Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION;

    // Activities for different destinations may coexist. Only the original activity
    // handles a repeated launch for its own destination while its camera is open.
    private static final Map<String, PhotoCaptureActivity> OPEN = new HashMap<>();

    private CaptureDraftStore store;
    private CaptureDraftStore.Draft draft;
    private String dest;
    private String label;
    private String rawName;
    private boolean asking;
    private boolean used;
    private boolean preparing;
    private boolean completed;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        dest = MemoFiles.dest(getIntent().getStringExtra(MemoFiles.EXTRA_DEST));
        label = MemoFiles.label(getIntent().getStringExtra(MemoFiles.EXTRA_LABEL));
        if (dest == null) { finish(); return; }
        PhotoCaptureActivity previous = OPEN.get(dest);
        if (previous != null && !previous.isFinishing() && !previous.isDestroyed()) {
            finish();
            return;
        }
        OPEN.put(dest, this);
        if (label == null) label = "Photo";
        store = new CaptureDraftStore(getFilesDir());
        setFinishOnTouchOutside(false);
        if (Build.VERSION.SDK_INT >= 33) setRecentsScreenshotEnabled(false);
        try {
            draft = state == null ? store.latest(dest, CaptureDraftStore.Kind.PHOTO) : store.get(state.getString("draft"));
        } catch (IOException e) {
            say("Could not open the photo draft");
            finish();
            return;
        }
        if (draft != null) label = draft.label;
        setTitle(label);
        if (state != null) {
            String raw = state.getString("raw");
            rawName = CaptureFiles.idOf(raw) == null || !rawFile(raw).isFile() ? null : raw;
            asking = state.getBoolean("asking");
            used = state.getBoolean("used");
        }
        render();
        if (rawName == null && draft != null && draft.confirmedPhoto().isFile()) prepare();
        else if (state == null && draft == null) requestCamera();
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        if (draft != null) state.putString("draft", draft.id);
        state.putString("raw", rawName);
        state.putBoolean("asking", asking);
        state.putBoolean("used", used);
    }

    private void requestCamera() {
        if (completed || preparing || asking || rawName != null) return;
        if (CameraAsk.mustAsk(declaredPermissions(), checkSelfPermission(CameraAsk.CAMERA) == PackageManager.PERMISSION_GRANTED)) {
            asking = true;
            render();
            requestPermissions(new String[] { CameraAsk.CAMERA }, REQUEST_CAMERA);
        } else {
            openCamera();
        }
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQUEST_CAMERA || !asking || completed || isFinishing() || isDestroyed()) return;
        asking = false;
        if (CameraAsk.granted(permissions, grantResults)) openCamera();
        else {
            say("No camera permission. No photo was taken.");
            render();
        }
    }

    private String[] declaredPermissions() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), PackageManager.GET_PERMISSIONS).requestedPermissions;
        } catch (PackageManager.NameNotFoundException e) {
            return null;
        }
    }

    private Uri uriFor(String name) {
        return new Uri.Builder().scheme("content").authority(getPackageName() + CaptureFiles.AUTHORITY_SUFFIX)
                .path(CaptureFiles.uriPath(name)).build();
    }

    private File rawFile(String name) { return new File(new File(getFilesDir(), CaptureDraftStore.CAMERA_DIR), name); }

    private void openCamera() {
        try {
            if (draft == null) draft = store.create(dest, label, CaptureDraftStore.Kind.PHOTO);
            String id = MemoFiles.newId(System.currentTimeMillis(), new SecureRandom().nextLong());
            rawName = CaptureFiles.rawName(id, dest);
            File raw = rawFile(rawName);
            File dir = raw.getParentFile();
            if ((!dir.isDirectory() && !dir.mkdirs()) || !raw.createNewFile()) throw new IOException("Cannot create capture file");
            Uri uri = uriFor(rawName);
            Intent capture = new Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT, uri);
            capture.setClipData(ClipData.newRawUri("", uri));
            capture.addFlags(GRANT);
            render();
            startActivityForResult(capture, REQUEST_CAPTURE);
        } catch (ActivityNotFoundException noCamera) {
            clearCamera();
            say("No camera app on this phone");
            render();
        } catch (IOException | RuntimeException refused) {
            clearCamera();
            say("Could not open the camera");
            render();
        }
    }

    private void clearCamera() {
        if (rawName == null) return;
        revokeCamera(rawName);
        rawFile(rawName).delete();
        rawName = null;
    }

    private void revokeCamera(String name) {
        try { revokeUriPermission(uriFor(name), GRANT); } catch (RuntimeException ignored) { }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_CAPTURE || rawName == null) return;
        final String name = rawName;
        rawName = null;
        revokeCamera(name);
        File raw = rawFile(name);
        if (completed || draft == null) {
            raw.delete();
            return;
        }
        try {
            if (store.retainCameraOutput(draft.id, raw, resultCode == RESULT_OK)) {
                used = false;
                prepare();
            } else {
                render();
            }
        } catch (IOException failed) {
            say("Could not save camera output");
            render();
        }
    }

    private void prepare() {
        preparing = true;
        used = false;
        render();
        CaptureDraftStore.Draft selected = draft;
        new Thread(() -> {
            boolean ready = false;
            File encoded = null;
            try {
                encoded = File.createTempFile("photo-", ".tmp", selected.directory);
                if (PhotoPlan.prepare(selected.confirmedPhoto(), encoded, new AndroidPixels())) {
                    ready = store.acceptPhoto(selected.id, encoded, true);
                }
            } catch (IOException ignored) {
                // The confirmed camera output remains private and can be tried again.
            } finally {
                if (encoded != null) encoded.delete();
            }
            boolean success = ready;
            runOnUiThread(() -> {
                if (isDestroyed() || isFinishing()) return;
                preparing = false;
                if (!success) say("The photo could not be prepared. Nothing was sent.");
                render();
            });
        }, "Daylight-photo").start();
    }

    private void render() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        int pad = Math.round(20 * getResources().getDisplayMetrics().density);
        layout.setPadding(pad, pad, pad, pad);
        TextView destination = new TextView(this);
        destination.setText(label);
        destination.setTextSize(22);
        layout.addView(destination);
        boolean review = draft != null && draft.hasContent();
        boolean busy = preparing || asking || rawName != null;
        boolean awaitingPreparation = draft != null && draft.confirmedPhoto().isFile();
        if (review) {
            ImageView preview = new ImageView(this);
            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inSampleSize = 2;
            preview.setImageBitmap(BitmapFactory.decodeFile(draft.file.getPath(), options));
            preview.setContentDescription("Photo draft");
            preview.setScaleType(ImageView.ScaleType.FIT_CENTER);
            layout.addView(preview, new LinearLayout.LayoutParams(-1, Math.round(240 * getResources().getDisplayMetrics().density)));
        }
        if (busy) {
            TextView status = new TextView(this);
            status.setText(preparing ? "Preparing photo…" : asking ? "Waiting for permission…" : "Camera is open");
            layout.addView(status);
        } else {
            if (awaitingPreparation) {
                addButton(layout, "Prepare photo again", this::prepare);
            } else if (review && !used) {
                addButton(layout, "Use photo", () -> { used = true; render(); });
            } else if (review) {
                addButton(layout, "Send", this::send);
            }
            addButton(layout, review ? "Retake" : "Open camera", this::requestCamera);
        }
        addButton(layout, "Discard", this::confirmDiscard);
        setContentView(layout);
    }

    private void addButton(LinearLayout layout, String label, Runnable action) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        button.setOnClickListener(v -> action.run());
        layout.addView(button);
    }

    private void send() {
        if (!used || draft == null || completed || preparing || draft.confirmedPhoto().isFile()) return;
        try {
            if (!store.send(draft.id)) return;
            completed = true;
            CaptureFiles.tellPayload();
            say("Queued for " + label);
            finish();
        } catch (IOException e) {
            say("Could not queue the photo. Check the draft and try again.");
        }
    }

    private void confirmDiscard() {
        if (completed) return;
        if (draft == null || !(preparing || draft.requiresDiscardConfirmation())) {
            discard(false);
            return;
        }
        new AlertDialog.Builder(this)
                .setTitle("Discard this photo draft?")
                .setNegativeButton("Keep draft", null)
                .setPositiveButton("Discard draft", (dialog, which) -> discard(true))
                .show();
    }

    private void discard(boolean confirmed) {
        try {
            if (draft != null && !store.discard(draft.id, confirmed)) return;
            completed = true;
            asking = false;
            clearCamera();
            finish();
        } catch (IOException e) {
            say("Could not discard the draft");
        }
    }

    @Override public void onBackPressed() { confirmDiscard(); }

    @Override protected void onDestroy() {
        if (dest != null && OPEN.get(dest) == this) OPEN.remove(dest);
        super.onDestroy();
    }

    private void say(String message) {
        Toast.makeText(getApplicationContext(), message, Toast.LENGTH_SHORT).show();
    }
}
