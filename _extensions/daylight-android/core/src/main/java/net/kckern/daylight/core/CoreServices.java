package net.kckern.daylight.core;

import android.content.Context;

/**
 * The parts of core that need a real Android context: crash log, heartbeat,
 * wifi telemetry, updater. Not constructed in JVM tests, where the context is null.
 */
final class CoreServices {
    final Context ctx;
    final Heartbeat heartbeat;
    final WifiLink wifiLink;
    final OwnUpdateConfirmation updateConfirmation;
    private final CoreConfig cfg;
    private final CoreContext core;

    CoreServices(CoreRuntime core, CoreConfig cfg) {
        this.core = core;
        this.ctx = (Context) core.shell().context();
        this.heartbeat = new Heartbeat(core, cfg);
        this.wifiLink = new WifiLink(ctx, cfg);
        this.cfg = cfg;
        this.updateConfirmation = new OwnUpdateConfirmation(ctx, core.accessibility(), core.log(), appLabel(ctx));
    }

    void start() {
        // First, so an unclean previous death is on record before anything else runs.
        CrashLog.install(ctx);
        // The piano bridge enabled its own accessibility service on every start
        // (WRITE_SECURE_SETTINGS, granted once over ADB). Same here, when the device asks for it.
        if (cfg.accessibilitySelfEnable()) {
            Diag.log("Daylight-Core", "enableAccessibilityService -> " + AccessibilityHub.enableOwnService(ctx, core));
        }
        heartbeat.start();
        wifiLink.start();
    }

    /** The Android side of POST /update. */
    UpdateFlow.Device updateDevice() {
        return new UpdateFlow.Device() {
            @Override public UpdateFlow.ApkInfo inspect(java.io.File apk) {
                try {
                    android.content.pm.PackageInfo info = ctx.getPackageManager().getPackageArchiveInfo(apk.getAbsolutePath(), 0);
                    return info == null ? null : new UpdateFlow.ApkInfo(info.packageName, versionCode(info));
                } catch (Throwable t) {
                    return null;
                }
            }
            @Override public String ownPackage() { return ctx.getPackageName(); }
            @Override public long installedVersionCode() {
                try {
                    return versionCode(ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0));
                } catch (Throwable t) {
                    // Unknown: refuse nothing on version grounds; the platform still refuses a downgrade.
                    return 0;
                }
            }
            @Override public int commit(java.io.File apk) throws Exception { return Updater.install(ctx, apk); }
            @Override public boolean autoConfirmSetting() { return cfg.updateAutoConfirm(); }
            @Override public void confirm(int sessionId) { updateConfirmation.begin(sessionId); }
        };
    }

    @SuppressWarnings("deprecation")
    private static long versionCode(android.content.pm.PackageInfo info) {
        return android.os.Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
    }

    void stop() {
        updateConfirmation.finish();
        wifiLink.stop();
        heartbeat.stop();
        CrashLog.markCleanShutdown();
    }

    /** The name the system's installer dialog shows for this app. */
    private static String appLabel(Context ctx) {
        try {
            return String.valueOf(ctx.getApplicationInfo().loadLabel(ctx.getPackageManager()));
        } catch (Throwable t) {
            return "";
        }
    }
}
