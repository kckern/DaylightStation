package net.kckern.daylight.cap.quickinput.shell;

import net.kckern.daylight.shellkit.DaylightTheme;
import net.kckern.daylight.shellkit.DaylightTheme.Radius;
import net.kckern.daylight.shellkit.DaylightTheme.Type;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.util.Log;
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
    private static final String TAG = "Daylight-Input";
    private static final int REQUEST_CAPTURE = 1;
    private static final int REQUEST_CAMERA = 2;
    private static final int GRANT = Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION;

    // Activities for different destinations may coexist. Only the original activity
    // handles a repeated launch for its own destination while its camera is open.
    private static final Map<String, PhotoCaptureActivity> OPEN = new HashMap<>();

    private CaptureDraftStore store;
    private String owner;
    private String sessionKey;
    private final CaptureScopeWait bindingWait = new CaptureScopeWait();
    private final DraftDiscard confirmation = new DraftDiscard();
    private AlertDialog discardDialog;
    private CaptureDraftStore.Draft draft;
    private String dest;
    private String label;
    private String rawName;
    private boolean cameraApproved;
    private boolean asking;
    private boolean used;
    private boolean preparing;
    private boolean preparationAttempted;
    private boolean stagingCamera;
    private boolean retakeAfterStaging;
    private File previewSource;
    private Bitmap previewBitmap;
    private boolean completed;
    private boolean launchCamera;
    private boolean resumed;

    @Override protected void attachBaseContext(android.content.Context base) {
        super.attachBaseContext(DaylightTheme.wrap(base));
    }

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        net.kckern.daylight.shellkit.UiTelemetry.install(this);
        dest = MemoFiles.dest(getIntent().getStringExtra(MemoFiles.EXTRA_DEST));
        label = MemoFiles.label(getIntent().getStringExtra(MemoFiles.EXTRA_LABEL));
        owner = getIntent().getStringExtra(CaptureScope.EXTRA);
        if (dest == null || !CaptureScope.canOpenCameraSession(owner, state != null)) {
            bindingUnavailable();
            return;
        }
        sessionKey = owner + ":" + dest;
        PhotoCaptureActivity previous = OPEN.get(sessionKey);
        if (previous != null && !previous.isFinishing() && !previous.isDestroyed()) {
            finish();
            return;
        }
        OPEN.put(sessionKey, this);
        if (label == null) label = "Photo";
        store = new CaptureDraftStore(getFilesDir(), owner);
        setFinishOnTouchOutside(false);
        if (Build.VERSION.SDK_INT >= 33) setRecentsScreenshotEnabled(false);
        try {
            draft = state == null ? store.latest(dest, CaptureDraftStore.Kind.PHOTO) : store.get(state.getString("draft"));
            if (draft != null && (!dest.equals(draft.dest) || draft.kind != CaptureDraftStore.Kind.PHOTO)) draft = null;
            rawName = store.confirmedCameraName(draft);
        } catch (IOException e) {
            say("Could not open the photo draft");
            finish();
            return;
        }
        if (draft != null) label = draft.label;
        cameraApproved = rawName != null;
        if (state != null) {
            if (rawName == null) {
                rawName = store.pendingCameraName(draft, state.getString("raw"));
                cameraApproved = rawName != null && state.getBoolean("camera-approved");
            }
            asking = state.getBoolean("asking");
            used = state.getBoolean("used");
        }
        launchCamera = state == null && draft == null;
        render();
    }

    @Override protected void onResume() {
        super.onResume();
        resumed = true;
        if (isFinishing()) return;
        refreshBinding();
    }

    @Override protected void onPause() {
        resumed = false;
        bindingWait.cancel();
        super.onPause();
    }

    private void refreshBinding() {
        if (CaptureScope.currentIs(owner)) {
            showAuthorizedDraft();
        } else {
            render();
            bindingWait.await(this, owner, this::showAuthorizedDraft, this::bindingUnavailable);
        }
    }

    private void showAuthorizedDraft() {
        if (!CaptureScope.currentIs(owner)) {
            bindingUnavailable();
            return;
        }
        render();
        if (cameraApproved && !stagingCamera) stageCameraResult();
        else if (used && !preparationAttempted && rawName == null && draft != null && draft.confirmedPhoto().isFile()) prepare();
        else if (launchCamera) {
            launchCamera = false;
            requestCamera();
        }
    }

    private void bindingUnavailable() {
        // A pending system-camera result can still be delivered after recreation, even
        // when the current pairing has already changed. Retain it for its original owner.
        if (rawName != null && (!cameraApproved || !draft.cameraResult().isFile())) {
            render();
            return;
        }
        say(CaptureScopeWait.UNAVAILABLE);
        finish();
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        if (draft != null) state.putString("draft", draft.id);
        state.putString("raw", rawName);
        state.putBoolean("camera-approved", cameraApproved);
        state.putBoolean("asking", asking);
        state.putBoolean("used", used);
    }

    private void requestCamera() {
        if (completed || preparing || asking || rawName != null || !CaptureScope.currentIs(owner)) return;
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
        if (requestCode != REQUEST_CAMERA) return;
        boolean ownerVerified = CaptureScope.currentIs(owner);
        CameraAsk.Reply reply = CameraAsk.afterReply(asking, CameraAsk.granted(permissions, grantResults), ownerVerified);
        asking = false;
        if (reply == CameraAsk.Reply.IGNORE || completed || isFinishing() || isDestroyed()) return;
        if (reply == CameraAsk.Reply.OPEN) {
            openCamera();
            return;
        }
        if (reply == CameraAsk.Reply.DENIED && ownerVerified) say("No camera permission. No photo was taken.");
        // A cold reply is consumed. Once the account is verified, the regular
        // Open camera or Retake control lets the user continue explicitly.
        render();
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

    private File rawFile(String name) { return store.cameraFile(name); }

    private void openCamera() {
        if (!CaptureScope.currentIs(owner)) {
            render();
            return;
        }
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
        cameraApproved = false;
    }

    private void revokeCamera(String name) {
        try { revokeUriPermission(uriFor(name), GRANT); } catch (RuntimeException ignored) { }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_CAPTURE || rawName == null || cameraApproved) return;
        if (completed || draft == null || resultCode != RESULT_OK) {
            clearCamera();
        } else {
            revokeCamera(rawName);
            cameraApproved = true;
            previewSource = null;
            previewBitmap = null;
            used = false;
            preparationAttempted = false;
            try {
                if (!store.recordCameraResult(draft.id, rawName, true)) clearCamera();
                else stageCameraResult();
            } catch (IOException failed) {
                Log.w(TAG, "Could not record camera receipt");
            }
        }
        if (resumed) refreshBinding();
    }

    private void stageCameraResult() {
        if (stagingCamera || draft == null || rawName == null) return;
        stagingCamera = true;
        CaptureDraftStore.Draft selected = draft;
        String cameraName = rawName;
        new Thread(() -> {
            boolean failed = false;
            try {
                store.retainCameraResult(selected.id, cameraName, true);
            } catch (IOException failure) {
                failed = true;
                Log.w(TAG, "Could not stage confirmed camera output");
            }
            boolean unavailable = failed;
            runOnUiThread(() -> {
                stagingCamera = false;
                if (completed || isDestroyed() || isFinishing() || !cameraName.equals(rawName)) return;
                if (unavailable) {
                    render();
                    if (CaptureScope.currentIs(owner)) say("Could not save camera output. Try saving it again.");
                    return;
                }
                rawName = null;
                cameraApproved = false;
                if (retakeAfterStaging) {
                    retakeAfterStaging = false;
                    requestCamera();
                } else if (used) prepare();
                render();
            });
        }, "Daylight-camera-stage").start();
    }

    private void acceptPreview() {
        if (!CaptureScope.currentIs(owner)) return;
        used = true;
        if (!stagingCamera && draft.confirmedPhoto().isFile() && !cameraApproved) prepare();
        else render();
    }

    private void retake() {
        if (stagingCamera) {
            retakeAfterStaging = true;
            used = false;
            return;
        }
        requestCamera();
    }

    private void loadPreview(File source, ImageView view) {
        if (!source.equals(previewSource)) {
            previewSource = source;
            previewBitmap = null;
            new Thread(() -> {
                BitmapFactory.Options options = new BitmapFactory.Options();
                options.inJustDecodeBounds = true;
                BitmapFactory.decodeFile(source.getPath(), options);
                options.inJustDecodeBounds = false;
                options.inSampleSize = PhotoPlan.sampleSize(options.outWidth, options.outHeight, 720);
                Bitmap bitmap = BitmapFactory.decodeFile(source.getPath(), options);
                if (bitmap != null) {
                    PhotoPlan.Turn turn = PhotoPlan.turn(PhotoPlan.readOrientation(() ->
                            new android.media.ExifInterface(source.getPath()).getAttributeInt(
                                    android.media.ExifInterface.TAG_ORIENTATION, 1)));
                    if (turn.degrees != 0 || turn.mirror) {
                        Matrix matrix = new Matrix();
                        matrix.postRotate(turn.degrees);
                        if (turn.mirror) matrix.postScale(-1, 1);
                        bitmap = Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), matrix, true);
                    }
                }
                Bitmap result = bitmap;
                runOnUiThread(() -> {
                    if (completed || isDestroyed() || isFinishing() || !source.equals(previewSource)
                            || !CaptureScope.currentIs(owner)) return;
                    previewBitmap = result;
                    if (result != null) render();
                });
            }, "Daylight-photo-preview").start();
        }
        view.setImageBitmap(previewBitmap);
    }

    private void prepare() {
        if (!CaptureScope.currentIs(owner) || preparing) return;
        preparing = true;
        preparationAttempted = true;
        render();
        CaptureDraftStore.Draft selected = draft;
        new Thread(() -> {
            PhotoPlan.Preparation result;
            File encoded = null;
            try {
                encoded = File.createTempFile("photo-", ".tmp", selected.directory);
                result = PhotoPlan.prepare(selected.confirmedPhoto(), encoded, new AndroidPixels());
                if (result == PhotoPlan.Preparation.READY && !store.acceptPhoto(selected.id, encoded, true)) {
                    result = PhotoPlan.Preparation.DRAFT_STORAGE;
                }
            } catch (IOException failed) {
                result = PhotoPlan.Preparation.DRAFT_STORAGE;
            } finally {
                if (encoded != null) encoded.delete();
            }
            PhotoPlan.Preparation outcome = result;
            if (outcome != PhotoPlan.Preparation.READY) Log.w(TAG, "Photo preparation failed: " + outcome.name());
            runOnUiThread(() -> {
                if (isDestroyed() || isFinishing()) return;
                preparing = false;
                if (outcome != PhotoPlan.Preparation.READY && CaptureScope.currentIs(owner)) {
                    say(outcome.message + " Nothing was sent.");
                }
                render();
            });
        }, "Daylight-photo").start();
    }

    private void render() {
        if (!CaptureScope.currentIs(owner)) {
            setTitle("Photo");
            TextView checking = new TextView(this);
            checking.setText(CaptureScopeWait.CHECKING);
            setContentView(checking);
            return;
        }
        setTitle(label);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        int pad = Math.round(20 * getResources().getDisplayMetrics().density);
        layout.setPadding(pad, pad, pad, pad);
        DaylightTheme t = DaylightTheme.of(this);
        TextView destination = t.text(this, label, Type.HEADLINE, t.ink, false);
        layout.addView(destination);
        File source = null;
        if (draft != null && (rawName == null || cameraApproved)) {
            if (cameraApproved && rawFile(rawName).isFile()) source = rawFile(rawName);
            else if (draft.confirmedPhoto().isFile()) source = draft.confirmedPhoto();
            else if (!cameraApproved && draft.hasContent()) source = draft.file;
        }
        boolean review = source != null;
        boolean busy = preparing || asking || rawName != null && !cameraApproved;
        boolean awaitingPreparation = draft != null && draft.confirmedPhoto().isFile();
        if (review) {
            ImageView preview = new ImageView(this);
            loadPreview(source, preview);
            preview.setContentDescription("Photo draft");
            preview.setScaleType(ImageView.ScaleType.FIT_CENTER);
            layout.addView(preview, new LinearLayout.LayoutParams(-1, Math.round(240 * getResources().getDisplayMetrics().density)));
        }
        if (cameraApproved && !stagingCamera) {
            addButton(layout, "Try saving photo again", this::stageCameraResult);
        } else if (busy) {
            TextView status = new TextView(this);
            status.setText(preparing ? "Preparing photo…" : asking ? "Waiting for permission…" : "Camera is open");
            layout.addView(status);
        } else if (review && !used) {
            addButton(layout, "Use photo", this::acceptPreview);
            addButton(layout, "Retake", this::retake);
        } else if (stagingCamera) {
            TextView status = new TextView(this);
            status.setText("Saving photo…");
            layout.addView(status);
        } else if (awaitingPreparation) {
            addButton(layout, "Prepare photo again", this::prepare);
            addButton(layout, "Retake", this::retake);
        } else if (review) {
            addButton(layout, "Send", this::send);
            addButton(layout, "Retake", this::retake);
        } else {
            addButton(layout, "Open camera", this::requestCamera);
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
        if (!used || draft == null || completed || preparing || rawName != null || draft.confirmedPhoto().isFile()
                || !CaptureScope.currentIs(owner)) return;
        try {
            if (!store.sendForCurrentOwner(draft.id)) return;
            completed = true;
            CaptureFiles.tellPayload(this);
            CaptureStatusActivity.open(this, owner, draft.id);
            finish();
        } catch (IOException e) {
            say("Could not queue the photo. Check the draft and try again.");
        }
    }

    private void confirmDiscard() {
        if (completed || !CaptureScope.currentIs(owner)) return;
        if (draft == null || !(preparing || cameraApproved || draft.requiresDiscardConfirmation())) {
            discard(draft == null ? null : draft.id, false);
            return;
        }
        invalidateDiscard();
        DraftDiscard.Request selected = confirmation.ask(draft.id);
        discardDialog = new AlertDialog.Builder(this, DaylightTheme.alert())
                .setTitle("Discard this photo draft?")
                .setNegativeButton("Keep draft", null)
                .setPositiveButton("Discard draft", (dialog, which) -> {
                    if (CaptureScope.currentIs(owner) && confirmation.confirm(selected, draft == null ? null : draft.id)) {
                        discard(selected.id, true);
                    }
                }).show();
    }

    private void discard(String id, boolean confirmed) {
        try {
            if (id != null && !store.discard(id, confirmed)) return;
            completed = true;
            asking = false;
            clearCamera();
            finish();
        } catch (IOException e) {
            say("Could not discard the draft");
        }
    }

    @Override public void onBackPressed() { confirmDiscard(); }

    private void invalidateDiscard() {
        confirmation.invalidate();
        if (discardDialog != null) {
            discardDialog.dismiss();
            discardDialog = null;
        }
    }

    @Override protected void onDestroy() {
        bindingWait.cancel();
        invalidateDiscard();
        if (sessionKey != null && OPEN.get(sessionKey) == this) OPEN.remove(sessionKey);
        super.onDestroy();
    }

    private void say(String message) {
        Toast.makeText(getApplicationContext(), message, Toast.LENGTH_SHORT).show();
    }
}
