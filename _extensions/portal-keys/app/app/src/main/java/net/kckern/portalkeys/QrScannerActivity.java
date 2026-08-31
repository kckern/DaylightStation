package net.kckern.portalkeys;

import android.Manifest;
import android.app.Activity;
import android.app.Dialog;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.hardware.Camera;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Gravity;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.google.zxing.BinaryBitmap;
import com.google.zxing.DecodeHintType;
import com.google.zxing.PlanarYUVLuminanceSource;
import com.google.zxing.Result;
import com.google.zxing.common.HybridBinarizer;
import com.google.zxing.qrcode.QRCodeReader;

import java.lang.ref.WeakReference;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.util.Collections;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Camera-backed school QR scanner for the Facebook Portal.
 *
 * The Portal's camera privacy service deliberately returns black frames unless an app
 * owns a live preview surface. A hidden/offscreen WebView video and Fully's motion
 * detector both fail that policy. This activity therefore owns a full-size SurfaceView,
 * while a separate fully opaque window covers it. Android sees a legitimate camera
 * preview; the child sees only the instructions. There is intentionally no visible-camera
 * mode. Frames stay in this process and are discarded immediately after ZXing examines
 * them. Only a decoded {@code sch:} token is sent to localhost, and token contents are
 * never logged.
 */
@SuppressWarnings("deprecation")
public final class QrScannerActivity extends Activity implements SurfaceHolder.Callback,
        Camera.PreviewCallback {

    private static final String TAG = PortalKeysService.TAG;
    private static final int CAMERA_PERMISSION_REQUEST = 41;
    private static final int CAMERA_ID = 0;
    private static final long TIMEOUT_MS = 20_000;
    private static final long FRAME_HEALTH_TIMEOUT_MS = 12_000;
    private static final Map<DecodeHintType, Object> QR_HINTS;
    private static volatile WeakReference<QrScannerActivity> active = new WeakReference<>(null);

    static {
        EnumMap<DecodeHintType, Object> hints = new EnumMap<>(DecodeHintType.class);
        hints.put(DecodeHintType.POSSIBLE_FORMATS,
                Collections.singletonList(com.google.zxing.BarcodeFormat.QR_CODE));
        hints.put(DecodeHintType.TRY_HARDER, Boolean.TRUE);
        QR_HINTS = Collections.unmodifiableMap(hints);
    }

    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService decoder = Executors.newSingleThreadExecutor();
    private final AtomicBoolean decoding = new AtomicBoolean(false);
    private final AtomicBoolean terminal = new AtomicBoolean(false);
    private final QRCodeReader reader = new QRCodeReader();

    private SurfaceView previewSurface;
    private TextView statusView;
    private FrameLayout instructionShield;
    private Dialog instructionDialog;
    private Camera camera;
    private Object smartCameraConnection;
    private Object smartCameraSession;
    private boolean smartCameraConnecting;
    private boolean smartCameraReady;
    private boolean smartCameraEnableRequested;
    private Camera.Size previewSize;
    private boolean surfaceReady;
    private int previewFrames;
    private boolean usableFrameSeen;

    private final Runnable timeout = new Runnable() {
        @Override public void run() {
            if (!terminal.compareAndSet(false, true)) return;
            setStatus("No QR code found.", false);
            PortalKeysService.publishQrStatus("timeout", null);
            stopCamera();
            ui.postDelayed(new Runnable() { @Override public void run() { finish(); } }, 700);
        }
    };

    private final Runnable frameHealthTimeout = new Runnable() {
        @Override public void run() {
            if (terminal.get() || usableFrameSeen) return;
            String reason = previewFrames == 0 ? "no-frames" : "black-frames";
            Log.e(TAG, "qr-scanner unusable-preview reason=" + reason
                    + " frameCount=" + previewFrames);
            fail(reason, "The camera is off. Turn it on with the button on top.");
        }
    };

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setStatusBarColor(Color.BLACK);
        getWindow().setNavigationBarColor(Color.BLACK);
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        setContentView(buildContent());
        showInstructionDialog();
        active = new WeakReference<>(this);
        PortalKeysService.publishQrStatus("opened", null);
        ui.postDelayed(timeout, TIMEOUT_MS);

        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            setStatus("Camera permission needed", false);
            PortalKeysService.publishQrStatus("permission-needed", null);
            requestPermissions(new String[]{Manifest.permission.CAMERA}, CAMERA_PERMISSION_REQUEST);
        }
    }

    private View buildContent() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);

        // This surface MUST stay attached, full-size, opaque and visible. Making it 1px,
        // offscreen, transparent or GONE makes the Portal privacy service black the feed.
        previewSurface = new SurfaceView(this);
        previewSurface.getHolder().addCallback(this);
        root.addView(previewSurface, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        instructionShield = new FrameLayout(this);
        instructionShield.setBackgroundColor(Color.BLACK);
        instructionShield.setAlpha(1f);
        instructionShield.setElevation(dp(8));
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setGravity(Gravity.CENTER_HORIZONTAL);
        content.setPadding(dp(48), dp(42), dp(48), dp(42));

        TextView glyph = text("▣  ▣\n▣  ◫", 38, Color.rgb(91, 205, 127));
        glyph.setGravity(Gravity.CENTER);
        content.addView(glyph);

        TextView heading = text("Scan your QR code", 48, Color.WHITE);
        heading.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams headingParams = wrap();
        headingParams.topMargin = dp(18);
        content.addView(heading, headingParams);

        TextView instruction = text(
                "Hold the code in front of the camera. Listen for the beep.",
                25, Color.rgb(180, 180, 192));
        instruction.setGravity(Gravity.CENTER);
        instruction.setMaxWidth(dp(720));
        LinearLayout.LayoutParams instructionParams = wrap();
        instructionParams.topMargin = dp(28);
        content.addView(instruction, instructionParams);

        statusView = text("Starting camera…", 25, Color.rgb(125, 218, 151));
        statusView.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams statusParams = wrap();
        statusParams.topMargin = dp(34);
        content.addView(statusView, statusParams);

        Button cancel = new Button(this);
        cancel.setText("Cancel");
        cancel.setTextSize(23);
        cancel.setTextColor(Color.WHITE);
        cancel.setBackgroundColor(Color.rgb(28, 28, 34));
        cancel.setMinWidth(dp(230));
        cancel.setMinHeight(dp(70));
        cancel.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) { cancelScan(); }
        });
        LinearLayout.LayoutParams cancelParams = wrap();
        cancelParams.topMargin = dp(34);
        content.addView(cancel, cancelParams);

        FrameLayout.LayoutParams contentParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.CENTER);
        instructionShield.addView(content, contentParams);
        return root;
    }

    /**
     * Keep the instruction shield in its own window. The Portal determines whether a
     * camera preview is legitimate from compositor visibility; a sibling view in the
     * camera window makes PreviewState=0. This window keeps the camera SurfaceView live
     * underneath while still presenting only opaque instructions to the child.
     */
    private void showInstructionDialog() {
        instructionDialog = new Dialog(this, android.R.style.Theme_Black_NoTitleBar_Fullscreen);
        instructionDialog.setContentView(instructionShield);
        instructionDialog.setCancelable(true);
        instructionDialog.setCanceledOnTouchOutside(false);
        instructionDialog.setOnCancelListener(dialog -> cancelScan());
        Window dialogWindow = instructionDialog.getWindow();
        if (dialogWindow != null) {
            dialogWindow.setBackgroundDrawable(new ColorDrawable(Color.BLACK));
            dialogWindow.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            dialogWindow.getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        }
        instructionDialog.show();
        if (dialogWindow != null) {
            dialogWindow.setLayout(WindowManager.LayoutParams.MATCH_PARENT,
                    WindowManager.LayoutParams.MATCH_PARENT);
        }
    }

    private TextView text(String value, int sp, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(sp);
        view.setTextColor(color);
        view.setFontFeatureSettings("kern");
        return view;
    }

    private LinearLayout.LayoutParams wrap() {
        return new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override public void surfaceCreated(SurfaceHolder holder) {
        surfaceReady = true;
        maybeStartCamera();
    }

    @Override public void surfaceChanged(SurfaceHolder holder, int format, int width, int height) {
        // The preview surface remains full-screen; camera configuration is fixed at open.
    }

    @Override public void surfaceDestroyed(SurfaceHolder holder) {
        surfaceReady = false;
        stopCamera();
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions,
            int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != CAMERA_PERMISSION_REQUEST) return;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            maybeStartCamera();
        } else {
            fail("permission-denied", "Camera permission is off.");
        }
    }

    private void maybeStartCamera() {
        if (!surfaceReady || camera != null || terminal.get()) return;
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) return;
        if (!smartCameraReady) {
            connectPortalSmartCamera();
            return;
        }
        try {
            camera = Camera.open(CAMERA_ID);
            Camera.Parameters params = camera.getParameters();
            previewSize = choosePreviewSize(params.getSupportedPreviewSizes());
            params.setPreviewSize(previewSize.width, previewSize.height);
            params.setPreviewFormat(android.graphics.ImageFormat.NV21);
            List<String> focusModes = params.getSupportedFocusModes();
            if (focusModes != null && focusModes.contains(Camera.Parameters.FOCUS_MODE_CONTINUOUS_VIDEO)) {
                params.setFocusMode(Camera.Parameters.FOCUS_MODE_CONTINUOUS_VIDEO);
            }
            camera.setParameters(params);
            camera.setPreviewDisplay(previewSurface.getHolder());
            int bufferSize = previewSize.width * previewSize.height
                    * android.graphics.ImageFormat.getBitsPerPixel(android.graphics.ImageFormat.NV21) / 8;
            camera.addCallbackBuffer(new byte[bufferSize]);
            camera.addCallbackBuffer(new byte[bufferSize]);
            camera.setPreviewCallbackWithBuffer(this);
            camera.startPreview();
            previewFrames = 0;
            usableFrameSeen = false;
            setStatus("Camera on — checking image…", true);
            PortalKeysService.publishQrStatus("camera-on", null);
            ui.postDelayed(frameHealthTimeout, FRAME_HEALTH_TIMEOUT_MS);
            Log.i(TAG, "qr-scanner camera-on id=" + CAMERA_ID + " size="
                    + previewSize.width + "x" + previewSize.height);
        } catch (Throwable error) {
            Log.e(TAG, "qr-scanner camera-open-failed: " + error.getClass().getSimpleName());
            stopCamera();
            fail("camera-open-failed", "Camera could not start.");
        }
    }

    /**
     * Camera 0 is Facebook's virtual camera, not the physical sensor. Opening the
     * Android camera alone leaves VirtualCameraManagerService with "No clients" and
     * SCAA returns no frames. The system-supplied Portal SDK is the supported client
     * registration/control path. Reflection keeps the APK build independent of the
     * proprietary system library while uses-library supplies it at runtime.
     */
    private void connectPortalSmartCamera() {
        if (smartCameraConnecting || smartCameraReady || terminal.get()) return;
        if (!SmartCameraPackageEnabler.isEnabled(this)) {
            enablePortalSmartCameraPackage();
            return;
        }
        smartCameraConnecting = true;
        setStatus("Starting smart camera…", true);
        PortalKeysService.publishQrStatus("smart-camera-connecting", null);
        try {
            ClassLoader loader = getClassLoader();
            Class<?> factoryClass = Class.forName(
                    "com.facebook.portal.smartcamera.client.base.api.control."
                            + "SmartCameraControlConnectionFactory", true, loader);
            Object factory = factoryClass.getConstructor(android.content.Context.class)
                    .newInstance(this);
            final Object asyncResult = factoryClass.getMethod("connect").invoke(factory);
            final Class<?> callbackClass = Class.forName(
                    "com.facebook.portal.smartcamera.client.base.api.common.concurrent."
                            + "ResultCallback", true, loader);
            Object callback = Proxy.newProxyInstance(loader, new Class<?>[]{callbackClass},
                    new InvocationHandler() {
                        @Override public Object invoke(Object proxy, Method method, Object[] args) {
                            if (method.getDeclaringClass() == Object.class) {
                                if ("toString".equals(method.getName())) return "PortalSmartCameraCallback";
                                if ("hashCode".equals(method.getName())) return System.identityHashCode(proxy);
                                if ("equals".equals(method.getName())) return proxy == args[0];
                            }
                            if ("onResult".equals(method.getName())
                                    && args != null && args.length == 1) {
                                acceptSmartCameraConnection(args[0]);
                            }
                            return null;
                        }
                    });
            Executor mainExecutor = new Executor() {
                @Override public void execute(Runnable command) { ui.post(command); }
            };
            Class<?> asyncResultClass = Class.forName(
                    "com.facebook.portal.smartcamera.client.base.api.common.concurrent."
                            + "AsyncResult", true, loader);
            asyncResultClass.getMethod("addListener", callbackClass, Executor.class)
                    .invoke(asyncResult, callback, mainExecutor);
        } catch (Throwable error) {
            smartCameraConnecting = false;
            Log.e(TAG, "qr-scanner smart-camera-connect-failed: "
                    + rootCauseName(error));
            fail("portal-sdk-connect-failed", "The camera could not start.");
        }
    }

    private void enablePortalSmartCameraPackage() {
        if (smartCameraEnableRequested || terminal.get()) return;
        smartCameraEnableRequested = true;
        ui.removeCallbacks(timeout);
        setStatus("Preparing the camera…", true);
        PortalKeysService.publishQrStatus("smart-camera-enabling", null);
        boolean started = PortalKeysService.enableSmartCameraPackage(new Runnable() {
            @Override public void run() {
                if (terminal.get() || isFinishing()) return;
                smartCameraEnableRequested = false;
                PortalKeysService.publishQrStatus("smart-camera-enabled", null);
                // App Info temporarily displaces this activity. Start a fresh scanner
                // after Settings closes so the preview surface is guaranteed foreground.
                terminal.set(true);
                stopCamera();
                finish();
                PortalKeysService.relaunchQrScanner();
            }
        }, new Runnable() {
            @Override public void run() {
                smartCameraEnableRequested = false;
                if (!terminal.get()) {
                    fail("portal-camera-service-disabled", "The camera could not start.");
                }
            }
        });
        if (!started) {
            smartCameraEnableRequested = false;
            fail("portal-camera-setup-unavailable", "The camera could not start.");
        }
    }

    private void acceptSmartCameraConnection(Object result) {
        if (terminal.get()) {
            try {
                Object connection = result.getClass().getMethod("getValue").invoke(result);
                connection.getClass().getMethod("close").invoke(connection);
            } catch (Throwable ignored) { }
            return;
        }
        try {
            boolean successful = (Boolean) result.getClass()
                    .getMethod("isSuccessful").invoke(result);
            if (!successful) {
                Throwable failure = (Throwable) result.getClass()
                        .getMethod("getThrowable").invoke(result);
                Log.e(TAG, "qr-scanner smart-camera-bind-failed: "
                        + failure.getClass().getSimpleName() + ": " + failure.getMessage());
                throw failure;
            }
            Object connection = result.getClass().getMethod("getValue").invoke(result);
            Object session = connection.getClass().getMethod("requestControls").invoke(connection);
            if (session == null) {
                try { connection.getClass().getMethod("close").invoke(connection); }
                catch (Throwable ignored) { }
                throw new IllegalStateException("smart camera control denied");
            }

            // DefaultAuto is the least opinionated supported pipeline mode. QR decode
            // uses the Android preview frames; no smart-camera metadata leaves the app.
            ClassLoader loader = getClassLoader();
            Class<?> modeSpecClass = Class.forName(
                    "com.facebook.portal.smartcamera.client.base.api.common.ModeSpec", true, loader);
            Class<?> defaultAutoClass = Class.forName(
                    "com.facebook.portal.smartcamera.client.base.api.common.ModeSpec$DefaultAuto",
                    true, loader);
            Object defaultAuto = defaultAutoClass.getMethod("create").invoke(null);
            session.getClass().getMethod("setMode", modeSpecClass).invoke(session, defaultAuto);

            smartCameraConnection = connection;
            smartCameraSession = session;
            smartCameraConnecting = false;
            smartCameraReady = true;
            PortalKeysService.publishQrStatus("smart-camera-ready", null);
            Log.i(TAG, "qr-scanner smart-camera-ready");
            maybeStartCamera();
        } catch (Throwable error) {
            smartCameraConnecting = false;
            Log.e(TAG, "qr-scanner smart-camera-control-failed: "
                    + rootCauseName(error));
            fail("portal-sdk-control-failed", "The camera could not start.");
        }
    }

    private static String rootCauseName(Throwable error) {
        Throwable current = error;
        while (current.getCause() != null && current.getCause() != current) {
            current = current.getCause();
        }
        return current.getClass().getSimpleName();
    }

    private Camera.Size choosePreviewSize(List<Camera.Size> sizes) {
        if (sizes == null || sizes.isEmpty()) throw new IllegalStateException("no preview sizes");
        for (Camera.Size size : sizes) {
            if (size.width == 640 && size.height == 480) return size;
        }
        for (Camera.Size size : sizes) {
            if (size.width == 320 && size.height == 240) return size;
        }
        return Collections.min(sizes, new Comparator<Camera.Size>() {
            @Override public int compare(Camera.Size a, Camera.Size b) {
                long target = 640L * 480L;
                return Long.compare(Math.abs((long) a.width * a.height - target),
                        Math.abs((long) b.width * b.height - target));
            }
        });
    }

    @Override public void onPreviewFrame(final byte[] data, final Camera sourceCamera) {
        if (data == null || previewSize == null || terminal.get()) {
            returnBuffer(sourceCamera, data);
            return;
        }
        inspectFrameHealth(data);
        if (!decoding.compareAndSet(false, true)) {
            returnBuffer(sourceCamera, data);
            return;
        }
        final int width = previewSize.width;
        final int height = previewSize.height;
        decoder.execute(new Runnable() {
            @Override public void run() {
                try {
                    PlanarYUVLuminanceSource luminance = new PlanarYUVLuminanceSource(
                            data, width, height, 0, 0, width, height, false);
                    BinaryBitmap bitmap = new BinaryBitmap(new HybridBinarizer(luminance));
                    Result result = reader.decode(bitmap, QR_HINTS);
                    String value = result == null ? null : result.getText();
                    if (value != null && value.trim().startsWith("sch:")) {
                        capture(value);
                    } else if (value != null) {
                        ui.post(new Runnable() {
                            @Override public void run() {
                                if (terminal.get()) return;
                                setStatus("That is not a school QR code.", false);
                                PortalKeysService.publishQrStatus("foreign", null);
                            }
                        });
                    }
                } catch (com.google.zxing.NotFoundException expected) {
                    // Most frames do not contain a QR code.
                } catch (Throwable error) {
                    Log.w(TAG, "qr-scanner decode-frame-failed: "
                            + error.getClass().getSimpleName());
                } finally {
                    reader.reset();
                    decoding.set(false);
                    if (!terminal.get()) returnBuffer(sourceCamera, data);
                }
            }
        });
    }

    /**
     * Privacy-gated Portal frames are byte-for-byte black. Report frame health without
     * retaining, hashing, serialising or logging any image content.
     */
    private void inspectFrameHealth(byte[] data) {
        previewFrames++;
        if (usableFrameSeen || previewSize == null) return;
        int luminanceBytes = Math.min(data.length, previewSize.width * previewSize.height);
        int minimum = 255;
        int maximum = 0;
        for (int i = 0; i < luminanceBytes; i += 257) {
            int sample = data[i] & 0xff;
            minimum = Math.min(minimum, sample);
            maximum = Math.max(maximum, sample);
        }
        // Privacy frames are perfectly flat (typically all 0 or all 16 in NV21).
        // A real dark scene still has sensor noise; a bright flat scene clears max>32.
        if (maximum - minimum > 8 || maximum > 32) {
            usableFrameSeen = true;
            ui.removeCallbacks(frameHealthTimeout);
            setStatus("Camera on", true);
            PortalKeysService.publishQrStatus("frames-live", null);
            Log.i(TAG, "qr-scanner frames-live after=" + previewFrames);
        }
    }

    private void returnBuffer(Camera sourceCamera, byte[] data) {
        try {
            if (sourceCamera != null && data != null && sourceCamera == camera) {
                sourceCamera.addCallbackBuffer(data);
            }
        } catch (RuntimeException ignored) {
            // Camera closed between decode completion and buffer return.
        }
    }

    private void capture(final String token) {
        ui.post(new Runnable() {
            @Override public void run() {
                if (!terminal.compareAndSet(false, true)) return;
                ui.removeCallbacks(timeout);
                stopCamera();
                setStatus("Code read", true);
                ToneGenerator tone = new ToneGenerator(AudioManager.STREAM_MUSIC, 85);
                tone.startTone(ToneGenerator.TONE_PROP_BEEP, 140);
                ui.postDelayed(tone::release, 250);
                PortalKeysService.publishQrCapture(token);
                Log.i(TAG, "qr-scanner captured school token");
                ui.postDelayed(new Runnable() { @Override public void run() { finish(); } }, 350);
            }
        });
    }

    private void fail(String code, String sentence) {
        if (!terminal.compareAndSet(false, true)) return;
        ui.removeCallbacks(timeout);
        stopCamera();
        setStatus(sentence, false);
        PortalKeysService.publishQrStatus("failed", code);
    }

    private void setStatus(String sentence, boolean on) {
        if (statusView == null) return;
        statusView.setText(sentence);
        statusView.setTextColor(on
                ? Color.rgb(125, 218, 151)
                : Color.rgb(205, 205, 214));
    }

    private void stopCamera() {
        ui.removeCallbacks(frameHealthTimeout);
        Camera current = camera;
        camera = null;
        if (current != null) {
            try { current.setPreviewCallbackWithBuffer(null); } catch (RuntimeException ignored) {}
            try { current.stopPreview(); } catch (RuntimeException ignored) {}
            try { current.release(); } catch (RuntimeException ignored) {}
            Log.i(TAG, "qr-scanner camera-off");
        }
        stopPortalSmartCamera();
    }

    private void stopPortalSmartCamera() {
        Object session = smartCameraSession;
        Object connection = smartCameraConnection;
        smartCameraSession = null;
        smartCameraConnection = null;
        smartCameraConnecting = false;
        smartCameraReady = false;
        if (session != null) {
            try { session.getClass().getMethod("close").invoke(session); }
            catch (Throwable ignored) { }
        }
        if (connection != null) {
            try { connection.getClass().getMethod("close").invoke(connection); }
            catch (Throwable ignored) { }
        }
    }

    private void cancelScan() {
        if (!terminal.compareAndSet(false, true)) {
            finish();
            return;
        }
        ui.removeCallbacks(timeout);
        stopCamera();
        PortalKeysService.publishQrStatus("cancelled", null);
        finish();
    }

    public static void cancelActive() {
        final QrScannerActivity activity = active.get();
        if (activity == null) return;
        activity.runOnUiThread(new Runnable() {
            @Override public void run() { activity.cancelScan(); }
        });
    }

    public static boolean isActive() {
        QrScannerActivity activity = active.get();
        return activity != null && !activity.terminal.get() && !activity.isFinishing();
    }

    @Override public void onBackPressed() { cancelScan(); }

    @Override protected void onDestroy() {
        ui.removeCallbacks(timeout);
        stopCamera();
        decoder.shutdownNow();
        if (instructionDialog != null) {
            instructionDialog.setOnCancelListener(null);
            instructionDialog.dismiss();
            instructionDialog = null;
        }
        if (active.get() == this) active = new WeakReference<>(null);
        super.onDestroy();
    }
}
