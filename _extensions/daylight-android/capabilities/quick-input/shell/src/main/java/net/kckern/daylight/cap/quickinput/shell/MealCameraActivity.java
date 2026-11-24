package net.kckern.daylight.cap.quickinput.shell;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.ImageFormat;
import android.graphics.SurfaceTexture;
import android.graphics.drawable.GradientDrawable;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCaptureSession;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraDevice;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CaptureRequest;
import android.hardware.camera2.params.StreamConfigurationMap;
import android.media.Image;
import android.media.ImageReader;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.Log;
import android.util.Size;
import android.view.Gravity;
import android.view.Surface;
import android.view.TextureView;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The meal photo camera: a viewfinder and a shutter, nothing between them and the queue.
 * Each shot goes to the same private draft pipeline the system-camera screen uses (draft,
 * EXIF removed, prepared, queued), but on a background thread and with no review step, so the
 * camera is ready for the next shot the moment the shutter is pressed. What happens to a photo
 * afterwards (replace it, retry it) is on the capture status screen, not a gate before it.
 *
 * If the phone has no usable back camera, this opens the
 * system-camera screen instead, so a capture is never lost to the permission.
 */
public final class MealCameraActivity extends Activity implements TextureView.SurfaceTextureListener {
    private static final String TAG = "Daylight-MealCamera";
    private static final int REQUEST_CAMERA = 17;
    /** Large enough for a meal, small enough to queue and send quickly. */
    private static final long MAX_PIXELS = 12_000_000L;

    private String dest;
    private String label;
    private String owner;
    private CaptureDraftStore store;

    private TextureView view;
    private TextView counter;
    private TextView notice;
    private TextView noticeAction;
    private View shutter;
    private View flash;

    private HandlerThread cameraThread;
    private Handler cameraHandler;
    private volatile CameraDevice camera;
    private volatile CameraCaptureSession session;
    private volatile ImageReader reader;
    /** True between onResume and onPause: a camera that finishes opening after that must be closed again. */
    private volatile boolean active;
    private Size previewSize;
    private int sensorOrientation;
    private boolean flashAvailable;
    private volatile boolean shotInFlight;
    private boolean fellBack;

    private final ExecutorService shots = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "Daylight-meal-shot");
        t.setDaemon(true);
        return t;
    });
    private int queued;
    private int failed;
    private String lastDraft;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        dest = MemoFiles.dest(getIntent().getStringExtra(MemoFiles.EXTRA_DEST));
        label = MemoFiles.label(getIntent().getStringExtra(MemoFiles.EXTRA_LABEL));
        owner = getIntent().getStringExtra(CaptureScope.EXTRA);
        if (dest == null || !CaptureScope.canOpenCameraSession(owner, state != null)) {
            Toast.makeText(getApplicationContext(), CaptureScopeWait.UNAVAILABLE, Toast.LENGTH_SHORT).show();
            finish();
            return;
        }
        if (label == null) label = "Photo";
        store = new CaptureDraftStore(getFilesDir(), owner);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setStatusBarColor(Color.BLACK);
        getWindow().setNavigationBarColor(Color.BLACK);
        build();
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.CAMERA}, REQUEST_CAMERA);
        }
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void build() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        view = new TextureView(this);
        view.setSurfaceTextureListener(this);
        root.addView(view, new FrameLayout.LayoutParams(-1, -1, Gravity.CENTER));

        // A white flash over the viewfinder confirms the shot without waiting for anything.
        flash = new View(this);
        flash.setBackgroundColor(Color.WHITE);
        flash.setAlpha(0f);
        root.addView(flash, new FrameLayout.LayoutParams(-1, -1));

        TextView close = chip("✕", 22);
        close.setContentDescription("Close the camera");
        close.setOnClickListener(v -> finish());
        FrameLayout.LayoutParams closeParams = new FrameLayout.LayoutParams(dp(48), dp(48), Gravity.TOP | Gravity.START);
        closeParams.setMargins(dp(16), dp(40), 0, 0);
        root.addView(close, closeParams);

        TextView title = chip(label, 15);
        title.setPadding(dp(16), 0, dp(16), 0);
        FrameLayout.LayoutParams titleParams = new FrameLayout.LayoutParams(-2, dp(40), Gravity.TOP | Gravity.CENTER_HORIZONTAL);
        titleParams.topMargin = dp(44);
        root.addView(title, titleParams);

        counter = chip("", 14);
        counter.setPadding(dp(16), 0, dp(16), 0);
        counter.setVisibility(View.GONE);
        counter.setOnClickListener(v -> {
            if (lastDraft != null) CaptureStatusActivity.open(this, owner, lastDraft);
        });
        FrameLayout.LayoutParams counterParams = new FrameLayout.LayoutParams(-2, dp(40), Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        counterParams.bottomMargin = dp(150);
        root.addView(counter, counterParams);

        // A message with one action, for the states the camera cannot fix by itself.
        android.widget.LinearLayout panel = new android.widget.LinearLayout(this);
        panel.setOrientation(android.widget.LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER);
        panel.setPadding(dp(32), 0, dp(32), 0);
        notice = new TextView(this);
        notice.setTextColor(Color.WHITE);
        notice.setTextSize(18);
        notice.setGravity(Gravity.CENTER);
        panel.addView(notice);
        noticeAction = chip("", 16);
        noticeAction.setPadding(dp(24), 0, dp(24), 0);
        android.widget.LinearLayout.LayoutParams actionParams = new android.widget.LinearLayout.LayoutParams(-2, dp(48));
        actionParams.topMargin = dp(20);
        panel.addView(noticeAction, actionParams);
        panel.setVisibility(View.GONE);
        panel.setTag("notice-panel");
        root.addView(panel, new FrameLayout.LayoutParams(-1, -1, Gravity.CENTER));

        shutter = new View(this);
        GradientDrawable ring = new GradientDrawable();
        ring.setShape(GradientDrawable.OVAL);
        ring.setColor(Color.WHITE);
        ring.setStroke(dp(5), 0x66ffffff);
        shutter.setBackground(ring);
        shutter.setContentDescription("Take photo");
        shutter.setOnClickListener(v -> takePhoto());
        FrameLayout.LayoutParams shutterParams = new FrameLayout.LayoutParams(dp(78), dp(78), Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        shutterParams.bottomMargin = dp(48);
        root.addView(shutter, shutterParams);
        setContentView(root);
    }

    /** Show a message over the viewfinder with one action; a null label hides the action. */
    private void showNotice(String message, String actionLabel, Runnable action) {
        runOnUiThread(() -> {
            View panel = ((ViewGroup) view.getParent()).findViewWithTag("notice-panel");
            notice.setText(message);
            noticeAction.setVisibility(actionLabel == null ? View.GONE : View.VISIBLE);
            if (actionLabel != null) {
                noticeAction.setText(actionLabel);
                noticeAction.setOnClickListener(v -> action.run());
            }
            panel.setVisibility(View.VISIBLE);
            shutter.setEnabled(false);
            shutter.setAlpha(0.4f);
        });
    }

    private void hideNotice() {
        runOnUiThread(() -> {
            View panel = ((ViewGroup) view.getParent()).findViewWithTag("notice-panel");
            panel.setVisibility(View.GONE);
            shutter.setEnabled(true);
            shutter.setAlpha(1f);
        });
    }

    private TextView chip(String text, int sp) {
        TextView chip = new TextView(this);
        chip.setText(text);
        chip.setTextSize(sp);
        chip.setTextColor(Color.WHITE);
        chip.setGravity(Gravity.CENTER);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(0x99000000);
        bg.setCornerRadius(dp(24));
        chip.setBackground(bg);
        return chip;
    }

    // ── permission ──────────────────────────────────────────────────────────

    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        if (request != REQUEST_CAMERA) return;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
            hideNotice();
            openWhenReady();
        } else {
            showCameraOff();
        }
    }

    /**
     * The permission is off. The phone's own camera app is not a way round it: a build that
     * declares CAMERA must hold it before the system camera will take a picture for it. So the
     * way forward is here: ask again while Android still lets us, otherwise open the app's
     * settings page where it can be switched on.
     */
    private void showCameraOff() {
        boolean canAsk = shouldShowRequestPermissionRationale(Manifest.permission.CAMERA);
        showNotice("Daylight needs the camera to take meal photos.",
                canAsk ? "Allow camera" : "Open settings",
                () -> {
                    if (canAsk) requestPermissions(new String[]{Manifest.permission.CAMERA}, REQUEST_CAMERA);
                    else startActivity(new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                            android.net.Uri.fromParts("package", getPackageName(), null)));
                });
    }

    /** The camera hardware cannot be used here at all: the phone's camera app takes over. */
    private void fallBack(String message) {
        if (fellBack) return;
        fellBack = true;
        if (message != null) Toast.makeText(getApplicationContext(), message, Toast.LENGTH_SHORT).show();
        startActivity(new Intent(this, PhotoCaptureActivity.class).putExtras(getIntent()));
        finish();
    }

    // ── camera ──────────────────────────────────────────────────────────────

    @Override protected void onResume() {
        super.onResume();
        if (store == null) return;
        active = true;
        cameraThread = new HandlerThread("Daylight-camera");
        cameraThread.start();
        cameraHandler = new Handler(cameraThread.getLooper());
        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) hideNotice();
        openWhenReady();
    }

    @Override protected void onPause() {
        active = false;
        closeCamera();
        if (cameraThread != null) {
            cameraThread.quitSafely();
            cameraThread = null;
            cameraHandler = null;
        }
        super.onPause();
    }

    @Override protected void onDestroy() {
        shots.shutdown();
        super.onDestroy();
    }

    private void openWhenReady() {
        if (store == null || fellBack || camera != null || cameraHandler == null) return;
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) return;
        if (view.isAvailable()) openCamera(view.getSurfaceTexture());
    }

    @Override public void onSurfaceTextureAvailable(SurfaceTexture texture, int width, int height) { openWhenReady(); }
    @Override public void onSurfaceTextureSizeChanged(SurfaceTexture texture, int width, int height) { }
    @Override public boolean onSurfaceTextureDestroyed(SurfaceTexture texture) { return true; }
    @Override public void onSurfaceTextureUpdated(SurfaceTexture texture) { }

    private void openCamera(SurfaceTexture texture) {
        CameraManager manager = getSystemService(CameraManager.class);
        try {
            String id = null;
            CameraCharacteristics chosen = null;
            for (String candidate : manager.getCameraIdList()) {
                CameraCharacteristics c = manager.getCameraCharacteristics(candidate);
                Integer facing = c.get(CameraCharacteristics.LENS_FACING);
                if (facing != null && facing == CameraCharacteristics.LENS_FACING_BACK) { id = candidate; chosen = c; break; }
            }
            if (id == null) { fallBack("No back camera found. Using the phone's camera app."); return; }
            StreamConfigurationMap map = chosen.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);
            Integer orientation = chosen.get(CameraCharacteristics.SENSOR_ORIENTATION);
            sensorOrientation = orientation == null ? 90 : orientation;
            Boolean flashInfo = chosen.get(CameraCharacteristics.FLASH_INFO_AVAILABLE);
            flashAvailable = flashInfo != null && flashInfo;
            if (map == null) { fallBack("The camera could not be read. Using the phone's camera app."); return; }

            Size still = pickStill(map.getOutputSizes(ImageFormat.JPEG));
            previewSize = pickPreview(map.getOutputSizes(SurfaceTexture.class), still);
            if (still == null || previewSize == null) { fallBack("The camera has no usable size. Using the phone's camera app."); return; }
            reader = ImageReader.newInstance(still.getWidth(), still.getHeight(), ImageFormat.JPEG, 2);
            reader.setOnImageAvailableListener(this::onImage, cameraHandler);

            // Portrait only: the sensor is landscape, so the viewfinder is the preview turned on its side.
            runOnUiThread(() -> fitViewfinder());
            texture.setDefaultBufferSize(previewSize.getWidth(), previewSize.getHeight());
            manager.openCamera(id, new CameraDevice.StateCallback() {
                @Override public void onOpened(CameraDevice device) {
                    if (!active) { device.close(); return; }
                    camera = device;
                    startPreview(texture);
                }

                @Override public void onDisconnected(CameraDevice device) {
                    device.close();
                    camera = null;
                    if (active) showNotice("The camera was taken by another app.", "Try again", () -> {
                        hideNotice();
                        openWhenReady();
                    });
                }

                @Override public void onError(CameraDevice device, int error) {
                    device.close();
                    camera = null;
                    Log.w(TAG, "camera error " + error);
                    runOnUiThread(() -> fallBack("The camera could not start. Using the phone's camera app."));
                }
            }, cameraHandler);
        } catch (CameraAccessException | SecurityException e) {
            Log.w(TAG, "could not open the camera: " + e.getClass().getSimpleName());
            fallBack("The camera could not start. Using the phone's camera app.");
        }
    }

    /** The largest 4:3 size under the pixel cap (or the largest overall if none is 4:3). */
    private static Size pickStill(Size[] sizes) {
        if (sizes == null || sizes.length == 0) return null;
        Size best = null;
        for (Size size : sizes) {
            long pixels = (long) size.getWidth() * size.getHeight();
            if (pixels > MAX_PIXELS || size.getWidth() * 3 != size.getHeight() * 4) continue;
            if (best == null || pixels > (long) best.getWidth() * best.getHeight()) best = size;
        }
        if (best != null) return best;
        for (Size size : sizes) {
            long pixels = (long) size.getWidth() * size.getHeight();
            if (pixels <= MAX_PIXELS && (best == null || pixels > (long) best.getWidth() * best.getHeight())) best = size;
        }
        return best != null ? best : sizes[sizes.length - 1];
    }

    /** A preview with the still's aspect ratio, big enough to look sharp but no more than 1080p. */
    private static Size pickPreview(Size[] sizes, Size still) {
        if (sizes == null || sizes.length == 0 || still == null) return null;
        List<Size> fits = new ArrayList<>();
        for (Size size : sizes) {
            if (size.getWidth() * still.getHeight() == size.getHeight() * still.getWidth() && size.getWidth() <= 1920) fits.add(size);
        }
        if (fits.isEmpty()) {
            for (Size size : sizes) if (size.getWidth() <= 1920) fits.add(size);
        }
        if (fits.isEmpty()) return sizes[sizes.length - 1];
        return Collections.max(fits, (a, b) -> Long.compare((long) a.getWidth() * a.getHeight(), (long) b.getWidth() * b.getHeight()));
    }

    /** Size the viewfinder so the (rotated) preview is not stretched. */
    private void fitViewfinder() {
        if (previewSize == null || view == null) return;
        ViewGroup parent = (ViewGroup) view.getParent();
        int width = parent.getWidth() > 0 ? parent.getWidth() : getResources().getDisplayMetrics().widthPixels;
        // Portrait: the preview's long side runs down the screen.
        int height = Math.round(width * (float) previewSize.getWidth() / previewSize.getHeight());
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(width, height, Gravity.CENTER);
        view.setLayoutParams(params);
    }

    private void startPreview(SurfaceTexture texture) {
        try {
            Surface preview = new Surface(texture);
            CaptureRequest.Builder request = camera.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);
            request.addTarget(preview);
            request.set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE);
            camera.createCaptureSession(java.util.Arrays.asList(preview, reader.getSurface()),
                    new CameraCaptureSession.StateCallback() {
                        @Override public void onConfigured(CameraCaptureSession configured) {
                            if (camera == null) return;
                            session = configured;
                            try {
                                session.setRepeatingRequest(request.build(), null, cameraHandler);
                            } catch (CameraAccessException | IllegalStateException e) {
                                Log.w(TAG, "preview failed: " + e.getClass().getSimpleName());
                            }
                        }

                        @Override public void onConfigureFailed(CameraCaptureSession failedSession) {
                            runOnUiThread(() -> fallBack("The camera could not start. Using the phone's camera app."));
                        }
                    }, cameraHandler);
        } catch (CameraAccessException | IllegalStateException e) {
            Log.w(TAG, "preview setup failed: " + e.getClass().getSimpleName());
            runOnUiThread(() -> fallBack("The camera could not start. Using the phone's camera app."));
        }
    }

    private void closeCamera() {
        try {
            if (session != null) { session.close(); session = null; }
            if (camera != null) { camera.close(); camera = null; }
            if (reader != null) { reader.close(); reader = null; }
        } catch (RuntimeException ignored) {
            // Already closed.
        }
        shotInFlight = false;
    }

    // ── a shot ──────────────────────────────────────────────────────────────

    private void takePhoto() {
        if (shotInFlight || camera == null || session == null) return;
        if (!CaptureScope.currentIs(owner)) {
            Toast.makeText(getApplicationContext(), CaptureScopeWait.UNAVAILABLE, Toast.LENGTH_SHORT).show();
            finish();
            return;
        }
        shotInFlight = true;
        flash.setAlpha(0.85f);
        flash.animate().alpha(0f).setDuration(160).start();
        try {
            CaptureRequest.Builder request = camera.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE);
            request.addTarget(reader.getSurface());
            request.set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE);
            request.set(CaptureRequest.CONTROL_AE_MODE, flashAvailable
                    ? CaptureRequest.CONTROL_AE_MODE_ON_AUTO_FLASH : CaptureRequest.CONTROL_AE_MODE_ON);
            request.set(CaptureRequest.JPEG_ORIENTATION, sensorOrientation);
            session.capture(request.build(), new CameraCaptureSession.CaptureCallback() {
                @Override public void onCaptureFailed(CameraCaptureSession s2, CaptureRequest r, android.hardware.camera2.CaptureFailure f) {
                    shotInFlight = false;
                    failed++;
                    runOnUiThread(MealCameraActivity.this::showCounter);
                }
            }, cameraHandler);
            // A shot that never arrives must not lock the shutter for good.
            cameraHandler.postDelayed(() -> shotInFlight = false, 4000);
        } catch (CameraAccessException | IllegalStateException e) {
            shotInFlight = false;
            Log.w(TAG, "capture failed: " + e.getClass().getSimpleName());
        }
    }

    /** The sensor's JPEG is ready: take its bytes and let go at once so the next shot can start. */
    private void onImage(ImageReader source) {
        byte[] bytes = null;
        Image image = null;
        try {
            image = source.acquireLatestImage();
            if (image != null) {
                ByteBuffer buffer = image.getPlanes()[0].getBuffer();
                bytes = new byte[buffer.remaining()];
                buffer.get(bytes);
            }
        } catch (RuntimeException e) {
            Log.w(TAG, "could not read the shot: " + e.getClass().getSimpleName());
        } finally {
            if (image != null) image.close();
        }
        shotInFlight = false;
        if (bytes == null) {
            failed++;
            runOnUiThread(this::showCounter);
            return;
        }
        byte[] jpeg = bytes;
        shots.execute(() -> queueShot(jpeg));
    }

    /** One photo through the private draft pipeline, to the upload queue. Off the main thread. */
    private void queueShot(byte[] jpeg) {
        CaptureDraftStore.Draft draft = null;
        boolean ok = false;
        File encoded = null;
        try {
            if (!CaptureScope.currentIs(owner)) throw new IOException("capture account not verified");
            draft = store.create(dest, label, CaptureDraftStore.Kind.PHOTO);
            String id = MemoFiles.newId(System.currentTimeMillis(), new SecureRandom().nextLong());
            String rawName = CaptureFiles.rawName(id, dest);
            File raw = store.cameraFile(rawName);
            File dir = raw.getParentFile();
            if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("Cannot create capture folder");
            try (FileOutputStream out = new FileOutputStream(raw)) { out.write(jpeg); }
            if (!store.recordCameraResult(draft.id, rawName, true)) throw new IOException("camera result refused");
            if (!store.retainCameraResult(draft.id, rawName, true)) throw new IOException("camera result not kept");
            encoded = File.createTempFile("photo-", ".tmp", draft.directory);
            PhotoPlan.Preparation prepared = PhotoPlan.prepare(draft.confirmedPhoto(), encoded, new AndroidPixels());
            if (prepared != PhotoPlan.Preparation.READY) throw new IOException("preparation: " + prepared.name());
            if (!store.acceptPhoto(draft.id, encoded, true)) throw new IOException("photo not accepted");
            if (!store.sendForCurrentOwner(draft.id)) throw new IOException("not queued");
            CaptureFiles.tellPayload(this);
            ok = true;
        } catch (IOException | RuntimeException e) {
            Log.w(TAG, "shot not queued: " + e.getMessage());
            if (draft != null) {
                try { store.discard(draft.id, true); } catch (IOException | RuntimeException ignored) { /* nothing more to do */ }
            }
        } finally {
            if (encoded != null) encoded.delete();
        }
        String sentId = ok && draft != null ? draft.id : null;
        runOnUiThread(() -> {
            if (sentId != null) { queued++; lastDraft = sentId; } else failed++;
            showCounter();
        });
    }

    private void showCounter() {
        if (queued == 0 && failed == 0) return;
        counter.setVisibility(View.VISIBLE);
        StringBuilder text = new StringBuilder();
        if (queued > 0) text.append("✓ ").append(queued).append(" queued");
        if (failed > 0) text.append(queued > 0 ? "  ·  " : "").append(failed).append(" not saved");
        if (queued > 0) text.append("  ·  Review");
        counter.setText(text);
    }
}
