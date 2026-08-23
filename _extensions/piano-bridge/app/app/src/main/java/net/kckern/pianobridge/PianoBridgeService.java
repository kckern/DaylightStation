package net.kckern.pianobridge;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.IBinder;
import android.util.Log;

import net.kckern.pianobridge.api.ShellServices;

import java.io.File;

/**
 * PianoBridgeService — the SHELL's foreground service. Deliberately tiny.
 *
 * Before 2026-08-23 this class WAS the bridge: ~750 lines of MIDI, BLE, kiosk
 * watchdog and control-plane logic, all of it frozen into the installed APK. Every
 * change meant a PackageInstaller confirm dialog and a human at the tablet.
 *
 * Now it owns only what Android binds to the installed package — the foreground
 * notification, the Service lifecycle, the JNI engine whose .so ships in the APK —
 * and hands everything else to a hot-swappable payload via {@link PayloadLoader}.
 * The old body lives on, unchanged in substance, as {@code BridgeCore} inside the
 * payload. See docs/_wip/plans/2026-08-23-piano-bridge-hotswap-payload.md.
 *
 * Rule for editing this file: if it can live in the payload, it does not belong here.
 */
public class PianoBridgeService extends Service {

    private static final String TAG = "PianoBridge";
    private static final String CHANNEL_ID = "piano_bridge";
    private static final int NOTIFICATION_ID = 2;

    private static volatile PianoBridgeService INSTANCE;

    private PianoEngine engine;
    private PayloadLoader loader;
    private ShellServer shellServer;
    private volatile String notificationText = "Starting…";

    /** For PianoTouchService to reach the loader (a11y forwarding). */
    static PayloadLoader loader() { PianoBridgeService s = INSTANCE; return s == null ? null : s.loader; }

    @Override
    public void onCreate() {
        super.onCreate();
        INSTANCE = this;
        ShellLog.install(this);
        createNotificationChannel();
        ShellLog.note("SHELL", "service created, versionCode=" + versionCode());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        postNotification();
        if (engine == null) {
            engine = new PianoEngine();
            if (!engine.init()) Log.e(TAG, "PianoEngine.init failed");
        }
        // The lifeline comes up BEFORE the payload, so even a payload that wedges on
        // start() leaves :8771 answering and /payload/rollback reachable.
        if (shellServer == null) {
            shellServer = new ShellServer(this);
            try {
                shellServer.start(0, true);
                ShellLog.note("SHELL", "lifeline server on :" + ShellServer.PORT);
            } catch (Exception e) {
                Log.e(TAG, "ShellServer failed to start", e);
                ShellLog.note("SHELL", "lifeline server FAILED: " + e.getMessage());
            }
        }
        if (loader == null) {
            loader = new PayloadLoader(this, new Shell());
            loader.boot();
        }
        // START_STICKY: the OS revives us after a kill; the loader's crash counter
        // then decides whether the payload that was running gets another chance.
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        ShellLog.note("SHELL", "service destroying");
        if (loader != null) { loader.shutdown(); loader = null; }
        if (shellServer != null) { shellServer.stop(); shellServer = null; }
        if (engine != null) { engine.stop(); engine.release(); engine = null; }
        INSTANCE = null;
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    /** Package-visible for ShellServer. */
    PayloadLoader loaderOrNull() { return loader; }

    int versionCode() {
        try {
            return (int) getPackageManager().getPackageInfo(getPackageName(), 0).getLongVersionCode();
        } catch (Exception e) { return -1; }
    }

    // ── notification (shell-owned: it is what makes this a foreground service) ──

    private void createNotificationChannel() {
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "Piano Bridge", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Piano bridge service notification");
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    private void postNotification() {
        Notification n = new Notification.Builder(this, CHANNEL_ID)
                .setContentTitle("Piano Bridge")
                .setContentText(notificationText)
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setOngoing(true)
                .build();
        // Foreground so Fully Kiosk can't kill it and it's legal to start from the
        // background. No mic here, so the Android-11 FGS mic restriction doesn't apply.
        startForeground(NOTIFICATION_ID, n);
    }

    // ── the one interface the payload sees ─────────────────────────────────

    private final class Shell implements ShellServices {
        @Override public Object context() { return PianoBridgeService.this; }
        @Override public void updateNotification(String text) {
            notificationText = text == null ? "" : text;
            postNotification();
        }
        @Override public Object engine() { return engine; }
        @Override public Object accessibilityService() { return PianoTouchService.current(); }
        @Override public int shellVersionCode() { return versionCode(); }
        @Override public File payloadDir() { return loader == null ? new File(getFilesDir(), "payloads") : loader.store().dir(); }
        @Override public String requestPayloadSwap(String url, String sha256) {
            return loader == null ? "refused: loader not ready" : loader.requestSwap(url, sha256);
        }
        @Override public String requestPayloadRollback() {
            return loader == null ? "refused: loader not ready" : loader.requestRollback();
        }
        @Override public String payloadStatusJson() {
            return loader == null ? "{\"ok\":false,\"error\":\"loader not ready\"}" : loader.status().toString();
        }
        @Override public void note(String kind, String msg) { ShellLog.note(kind, msg); }
    }
}
