package net.kckern.daylight.cap.presence;

import android.content.Context;

import net.kckern.daylight.core.Capability;
import net.kckern.daylight.core.CoreContext;
import net.kckern.daylight.core.Replies;

import org.json.JSONObject;

/**
 * Reports which bonded Bluetooth devices are connected to a backend endpoint.
 * The endpoint is a setting (empty means not configured) and the token is a secret
 * setting, set on the device and never compiled in.
 */
public final class PresenceCapability implements Capability {
    private CoreContext core;
    private PresenceConfig config;
    private volatile PresenceReporter reporter;

    @Override public String name() { return "presence"; }

    @Override public void register(CoreContext core) {
        this.core = core;
        PresenceConfig.declare(core.settings());
        config = new PresenceConfig(core.settings());
        core.router().route("GET", "/presence", req -> {
            PresenceReporter r = reporter;
            return Replies.json(r == null ? Replies.err("not started") : new JSONObject(r.toJson()).put("ok", true));
        });
    }

    @Override public void start() {
        Context shellContext = (Context) core.shell().context();
        // JVM tests boot every capability with no Android context: nothing to report.
        if (shellContext == null) return;
        Context ctx = shellContext.getApplicationContext();
        String version;
        try {
            // What BuildConfig.VERSION_NAME was in portal-keys: the installed app's version name.
            version = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0).versionName;
        } catch (Exception e) {
            version = "unknown";
        }
        PresenceReporter r = new PresenceReporter(ctx, config, core.log(), version);
        r.start();
        reporter = r;
    }

    @Override public void stop() {
        PresenceReporter r = reporter;
        reporter = null;
        if (r != null) r.stop();
    }
}
