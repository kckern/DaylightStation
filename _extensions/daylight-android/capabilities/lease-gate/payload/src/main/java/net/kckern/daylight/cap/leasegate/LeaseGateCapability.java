package net.kckern.daylight.cap.leasegate;

import android.content.Context;
import android.os.SystemClock;

import net.kckern.daylight.core.Capability;
import net.kckern.daylight.core.CoreContext;
import net.kckern.daylight.core.LiveSwitch;
import net.kckern.daylight.core.Router;
import net.kckern.daylight.core.SettingsRegistry;
import net.kckern.daylight.core.spi.PackageGate;

import org.json.JSONObject;

import java.io.File;

/**
 * A server-issued lease decides whether one native app may run. The loop polls for
 * the lease and expires it locally; hiding the package goes through PackageGate, which
 * nothing provides in this phase, so the gate stays closed and says why.
 */
public final class LeaseGateCapability implements Capability {
    /** What GET /lease reports before the loop exists. */
    private final LeaseDeadline lease = new LeaseDeadline();
    private CoreContext core;
    private volatile LeaseLoop loop;
    private volatile Context context;
    /** lease.enabled: whether this app runs the lease loop. Off while supervision-guard still does. */
    private LiveSwitch leaseSwitch;
    /** Test seam: the loop's platform. Null means the real one, built from the context. */
    private volatile LeaseLoop.Platform platformForTest;
    void usePlatformForTest(LeaseLoop.Platform p) { platformForTest = p; }

    @Override public String name() { return "lease-gate"; }

    @Override public void register(CoreContext core) {
        this.core = core;
        core.settings().declare("lease.endpoint", SettingsRegistry.Type.STRING, "");
        core.settings().declare("lease.packageName", SettingsRegistry.Type.STRING, "");
        core.settings().declareSecret("lease.credential");
        leaseSwitch = LiveSwitch.declare(core, "lease.enabled", new LiveSwitch.Part() {
            @Override public void acquire() { startLoop(); }
            @Override public void release() { stopLoop(); }
        });
        core.router().route("GET", "/lease", req -> {
            LeaseLoop l = loop;
            if (l != null) return Router.Response.json(200, l.status().put("ok", true));
            // A payload that has not started.
            return Router.Response.json(200, new JSONObject()
                    .put("ok", true)
                    .put("configured", !((String) core.settings().get("lease.endpoint")).isEmpty())
                    .put("blocked", lease.blocked(SystemClock.elapsedRealtime()))
                    .put("epoch", lease.epoch())
                    .put("revision", lease.revision())
                    .put("enforcement", "unavailable"));
        });
    }

    /**
     * The endpoint, credential and package are read once, when the loop starts, as
     * GuardService read its file once. Changing them takes a payload restart, or
     * lease.enabled off and on.
     */
    @Override public void start() {
        Context ctx = (Context) core.shell().context();
        // JVM tests boot every capability with no Android context: nothing to enforce.
        if (ctx == null) return;
        context = ctx;
        leaseSwitch.start();
    }

    private void startLoop() {
        Context ctx = context;
        if (ctx == null) throw new IllegalStateException("not started");
        LeaseOrder order = new LeaseOrder(new File(core.shell().payloadDir(), "state/lease-order.json"));
        LeaseLoop.Platform given = platformForTest;
        LeaseLoop l = given == null
                ? new LeaseLoop(ctx, order, () -> core.services().find(PackageGate.class),
                        (String) core.settings().get("lease.endpoint"),
                        (String) core.settings().get("lease.credential"),
                        (String) core.settings().get("lease.packageName"))
                : new LeaseLoop(given, order, () -> core.services().find(PackageGate.class),
                        (String) core.settings().get("lease.endpoint"),
                        (String) core.settings().get("lease.credential"),
                        (String) core.settings().get("lease.packageName"), ctx.getPackageName(), true);
        loop = l;
        l.start();
    }

    private void stopLoop() {
        LeaseLoop l = loop;
        loop = null;
        if (l != null) l.stop();
    }

    @Override public void stop() {
        if (leaseSwitch != null) leaseSwitch.stop();
        stopLoop();
    }
}
