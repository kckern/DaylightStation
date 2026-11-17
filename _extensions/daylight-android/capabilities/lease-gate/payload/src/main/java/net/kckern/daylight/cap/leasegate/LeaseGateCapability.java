package net.kckern.daylight.cap.leasegate;

import android.os.SystemClock;

import net.kckern.daylight.core.Capability;
import net.kckern.daylight.core.CoreContext;
import net.kckern.daylight.core.Router;
import net.kckern.daylight.core.SettingsRegistry;

import org.json.JSONObject;

public final class LeaseGateCapability implements Capability {
    private final LeaseDeadline lease = new LeaseDeadline();

    @Override public String name() { return "lease-gate"; }

    @Override public void register(CoreContext core) {
        core.settings().declare("lease.endpoint", SettingsRegistry.Type.STRING, "");
        core.settings().declare("lease.packageName", SettingsRegistry.Type.STRING, "");
        core.router().route("GET", "/lease", req -> Router.Response.json(200, new JSONObject()
                .put("ok", true)
                .put("configured", !((String) core.settings().get("lease.endpoint")).isEmpty())
                .put("blocked", lease.blocked(SystemClock.elapsedRealtime()))
                .put("epoch", lease.epoch())
                .put("revision", lease.revision())
                // Task 23 replaces this with the state of the enforcement loop.
                .put("enforcement", "unavailable")));
    }

    @Override public void start() { }

    @Override public void stop() { }
}
