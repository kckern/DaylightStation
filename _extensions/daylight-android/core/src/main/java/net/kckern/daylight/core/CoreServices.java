package net.kckern.daylight.core;

import android.content.Context;

/**
 * The parts of core that need a real Android context: crash log, heartbeat,
 * wifi telemetry, updater. Not constructed in JVM tests, where the context is null.
 */
final class CoreServices {
    final Context ctx;
    final Heartbeat heartbeat;

    CoreServices(CoreRuntime core, CoreConfig cfg) {
        this.ctx = (Context) core.shell().context();
        this.heartbeat = new Heartbeat(core, cfg);
    }

    void start() {
        // First, so an unclean previous death is on record before anything else runs.
        CrashLog.install(ctx);
        heartbeat.start();
    }

    void stop() {
        heartbeat.stop();
        CrashLog.markCleanShutdown();
    }
}
