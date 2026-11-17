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

    CoreServices(CoreRuntime core, CoreConfig cfg) {
        this.ctx = (Context) core.shell().context();
        this.heartbeat = new Heartbeat(core, cfg);
        this.wifiLink = new WifiLink(ctx, cfg);
        this.cfg = cfg;
        this.updateConfirmation = new OwnUpdateConfirmation(core.accessibility(), core.log(), appLabel(ctx));
    }

    void start() {
        // First, so an unclean previous death is on record before anything else runs.
        CrashLog.install(ctx);
        // The piano bridge enabled its own accessibility service on every start
        // (WRITE_SECURE_SETTINGS, granted once over ADB). Same here, when the device asks for it.
        if (cfg.accessibilitySelfEnable()) {
            String component = new android.content.ComponentName(ctx, AccessibilityHub.SERVICE_CLASS).flattenToString();
            Diag.log("Daylight-Core", "enableAccessibilityService " + component + " -> "
                    + SettingsControl.enableAccessibilityService(ctx, component));
        }
        heartbeat.start();
        wifiLink.start();
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
