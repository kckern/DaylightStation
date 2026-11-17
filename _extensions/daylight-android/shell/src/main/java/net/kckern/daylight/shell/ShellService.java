package net.kckern.daylight.shell;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.IBinder;
import android.util.Log;

import net.kckern.daylight.api.ShellComponents;
import net.kckern.daylight.api.ShellServices;

import java.io.File;

/**
 * The shell's foreground service. It owns only what Android binds to the installed
 * package and hands everything else to a hot-swappable payload.
 *
 * Rule for editing this file: if it can live in the payload, it does not belong here.
 */
public class ShellService extends Service implements ShellServer.Host {
    private static final String TAG = "Daylight";
    private static final String CHANNEL_ID = "daylight_shell";
    private static final int NOTIFICATION_ID = 2;

    private static volatile ShellService INSTANCE;

    /** Lifeline socket read timeout: a client that connects and sends nothing gives its thread back. */
    private static final int LIFELINE_READ_TIMEOUT_MS = 5000;
    private static final java.util.concurrent.atomic.AtomicBoolean CRASH_HANDLER_INSTALLED =
            new java.util.concurrent.atomic.AtomicBoolean();

    /** Read by lifeline threads and by the component listener, written on the main thread. */
    private volatile PayloadLoader loader;
    private ShellServer lifeline;
    private volatile String notificationText = "Starting…";

    static boolean isRunning() { return INSTANCE != null; }

    /**
     * Called by a manifest-declared component when Android binds or unbinds it.
     * Pass null as instance on unbind.
     */
    public static void publishComponent(String name, Object instance) {
        ShellComponents.publish(name, instance);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        INSTANCE = this;
        ShellComponents.setListener((name, instance) -> {
            PayloadLoader l = loader;
            if (l != null) l.onShellComponent(name, instance);
        });
        ShellLog.install(this);
        createNotificationChannel();
        ShellLog.note("SHELL", "service created, device=" + BuildConfig.DEVICE_ID + " versionCode=" + versionCode());
        installRestartOnCrash();
        ShellKeepAlive.schedule(this);
    }

    /**
     * Before the default handler kills the process, set an alarm that starts the service again.
     * Installed once per process: a second service creation would otherwise wrap the first
     * handler and set the alarm twice for one crash.
     */
    private void installRestartOnCrash() {
        if (!CRASH_HANDLER_INSTALLED.compareAndSet(false, true)) return;
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
        // The lifeline comes up before the payload, so a payload that hangs on
        // start still leaves rollback reachable.
        if (lifeline == null) {
            ShellServer server = new ShellServer(this, BuildConfig.LIFELINE_PORT, BuildConfig.CONTROL_TOKEN);
            try {
                server.start(LIFELINE_READ_TIMEOUT_MS, true);
                lifeline = server;
                ShellLog.note("SHELL", "lifeline on :" + BuildConfig.LIFELINE_PORT);
            } catch (Exception e) {
                // lifeline stays null, so the next onStartCommand (the keep-alive alarm) tries again.
                Log.e(TAG, "lifeline failed to start", e);
                ShellLog.note("SHELL", "lifeline FAILED: " + e.getMessage());
                try { server.stop(); } catch (Throwable ignored) { }
            }
        }
        if (loader == null) {
            PayloadLoader l = new PayloadLoader(this, new Shell(), versionCode());
            loader = l;
            // Queued on the loader's own thread: a payload's start() never runs on the main thread.
            l.boot();
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        ShellLog.note("SHELL", "service destroying");
        PayloadLoader l = loader;
        loader = null;
        if (l != null) l.shutdown();
        if (lifeline != null) { lifeline.stop(); lifeline = null; }
        ShellComponents.setListener(null);
        INSTANCE = null;
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public PayloadLoader loaderOrNull() { return loader; }

    @Override public int versionCode() {
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
            PayloadLoader l = loader;
            return l == null ? new File(getFilesDir(), "payloads") : l.store().dir();
        }
        @Override public Object component(String name) { return ShellComponents.get(name); }
        @Override public void updateNotification(String text) {
            notificationText = text == null ? "" : text;
            postNotification();
        }
        @Override public String requestPayloadSwap(String url, String sha256) {
            PayloadLoader l = loader;
            return l == null ? "refused: loader not ready" : l.requestSwap(url, sha256);
        }
        @Override public String requestPayloadRollback() {
            PayloadLoader l = loader;
            return l == null ? "refused: loader not ready" : l.requestRollback();
        }
        @Override public String payloadStatusJson() {
            PayloadLoader l = loader;
            return l == null ? "{\"ok\":false,\"error\":\"loader not ready\"}" : l.status().toString();
        }
        @Override public void note(String kind, String message) { ShellLog.note(kind, message); }
    }
}
