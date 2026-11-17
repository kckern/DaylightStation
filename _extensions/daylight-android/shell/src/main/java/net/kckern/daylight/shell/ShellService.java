package net.kckern.daylight.shell;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.IBinder;
import android.util.Log;

import net.kckern.daylight.api.ShellServices;

import java.io.File;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The shell's foreground service. It owns only what Android binds to the installed
 * package and hands everything else to a hot-swappable payload.
 *
 * Rule for editing this file: if it can live in the payload, it does not belong here.
 */
public class ShellService extends Service {
    private static final String TAG = "Daylight";
    private static final String CHANNEL_ID = "daylight_shell";
    private static final int NOTIFICATION_ID = 2;

    private static volatile ShellService INSTANCE;
    /** Shell-owned objects a payload may ask for by name (accessibility service, native engine). */
    private static final Map<String, Object> COMPONENTS = new ConcurrentHashMap<>();

    private PayloadLoader loader;
    private ShellServer lifeline;
    private volatile String notificationText = "Starting…";

    static boolean isRunning() { return INSTANCE != null; }

    /**
     * Called by a manifest-declared component when Android binds or unbinds it.
     * Pass null as instance on unbind.
     */
    public static void publishComponent(String name, Object instance) {
        if (instance == null) COMPONENTS.remove(name); else COMPONENTS.put(name, instance);
        ShellService s = INSTANCE;
        if (s != null && s.loader != null) s.loader.onShellComponent(name, instance);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        INSTANCE = this;
        ShellLog.install(this);
        createNotificationChannel();
        ShellLog.note("SHELL", "service created, device=" + BuildConfig.DEVICE_ID + " versionCode=" + versionCode());
        installRestartOnCrash();
        ShellKeepAlive.schedule(this);
    }

    /** Before the default handler kills the process, set an alarm that starts the service again. */
    private void installRestartOnCrash() {
        final Thread.UncaughtExceptionHandler prev = Thread.getDefaultUncaughtExceptionHandler();
        final android.content.Context app = getApplicationContext();
        Thread.setDefaultUncaughtExceptionHandler((thread, ex) -> {
            try {
                ShellLog.note("CRASH", "uncaught on " + thread.getName() + ": " + ex + ", restart alarm set");
                ShellKeepAlive.soon(app, 3_000L);
            } catch (Throwable ignored) { }
            if (prev != null) prev.uncaughtException(thread, ex);
        });
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        postNotification();
        // The lifeline comes up before the payload, so a payload that wedges on
        // start still leaves rollback reachable.
        if (lifeline == null) {
            lifeline = new ShellServer(this, BuildConfig.LIFELINE_PORT, BuildConfig.CONTROL_TOKEN);
            try {
                lifeline.start(0, true);
                ShellLog.note("SHELL", "lifeline on :" + BuildConfig.LIFELINE_PORT);
            } catch (Exception e) {
                Log.e(TAG, "lifeline failed to start", e);
                ShellLog.note("SHELL", "lifeline FAILED: " + e.getMessage());
            }
        }
        if (loader == null) {
            loader = new PayloadLoader(this, new Shell());
            loader.boot();
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        ShellLog.note("SHELL", "service destroying");
        if (loader != null) { loader.shutdown(); loader = null; }
        if (lifeline != null) { lifeline.stop(); lifeline = null; }
        INSTANCE = null;
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    PayloadLoader loaderOrNull() { return loader; }

    int versionCode() {
        try {
            android.content.pm.PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
            // getLongVersionCode() arrived in API 28. Below that the call is a NoSuchMethodError,
            // which the catch below would not stop, so read the old field instead.
            return android.os.Build.VERSION.SDK_INT >= 28 ? (int) info.getLongVersionCode() : info.versionCode;
        } catch (Exception e) { return -1; }
    }

    private void createNotificationChannel() {
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Daylight", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Daylight device service");
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    private void postNotification() {
        Notification n = new Notification.Builder(this, CHANNEL_ID)
                .setContentTitle("Daylight")
                .setContentText(notificationText)
                .setSmallIcon(android.R.drawable.ic_menu_info_details)
                .setOngoing(true)
                .build();
        startForeground(NOTIFICATION_ID, n);
    }

    private final class Shell implements ShellServices {
        @Override public Object context() { return ShellService.this; }
        @Override public String deviceId() { return BuildConfig.DEVICE_ID; }
        @Override public int shellVersionCode() { return versionCode(); }
        @Override public String controlToken() { return BuildConfig.CONTROL_TOKEN; }
        @Override public File payloadDir() {
            return loader == null ? new File(getFilesDir(), "payloads") : loader.store().dir();
        }
        @Override public Object component(String name) { return COMPONENTS.get(name); }
        @Override public void updateNotification(String text) {
            notificationText = text == null ? "" : text;
            postNotification();
        }
        @Override public String requestPayloadSwap(String url, String sha256) {
            return loader == null ? "refused: loader not ready" : loader.requestSwap(url, sha256);
        }
        @Override public String requestPayloadRollback() {
            return loader == null ? "refused: loader not ready" : loader.requestRollback();
        }
        @Override public String payloadStatusJson() {
            return loader == null ? "{\"ok\":false,\"error\":\"loader not ready\"}" : loader.status().toString();
        }
        @Override public void note(String kind, String message) { ShellLog.note(kind, message); }
    }
}
