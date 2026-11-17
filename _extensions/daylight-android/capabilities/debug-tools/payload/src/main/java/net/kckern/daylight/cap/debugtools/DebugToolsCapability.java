package net.kckern.daylight.cap.debugtools;

import android.os.Build;
import android.os.SystemClock;

import net.kckern.daylight.core.Capability;
import net.kckern.daylight.core.CoreContext;
import net.kckern.daylight.core.Router;
import net.kckern.daylight.core.SettingsRegistry;

import org.json.JSONObject;

public final class DebugToolsCapability implements Capability {
    @Override public String name() { return "debug-tools"; }

    @Override public void register(CoreContext core) {
        // Off by default. The shell route added in phase 3 refuses to run unless this is true.
        core.settings().declare("debug.execEnabled", SettingsRegistry.Type.BOOLEAN, false);
        core.router().route("GET", "/debug/info", req -> Router.Response.json(200, new JSONObject()
                .put("ok", true)
                .put("device", core.deviceId())
                .put("model", String.valueOf(Build.MODEL))
                .put("sdkInt", Build.VERSION.SDK_INT)
                .put("elapsedRealtimeMs", SystemClock.elapsedRealtime())));
    }

    @Override public void start() { }

    @Override public void stop() { }
}
