package net.kckern.daylight.payload;

import net.kckern.daylight.api.Payload;
import net.kckern.daylight.api.ShellServices;
import net.kckern.daylight.core.Capability;
import net.kckern.daylight.core.ControlServer;
import net.kckern.daylight.core.CoreRuntime;
import net.kckern.daylight.generated.DeviceConfig;

import org.json.JSONObject;

import java.io.File;

/** The fixed entry class the shell loads. Wires the device's capabilities into the core. */
public final class Main implements Payload {
    private static final int BIND_ATTEMPTS = 15;

    /** Written on the loader's thread, read by onShellComponent on whichever thread Android binds a component. */
    private volatile CoreRuntime core;
    private volatile ControlServer server;
    /**
     * Set by stop() and never cleared: the loader builds a new Main for every start.
     * It may call stop() while start() is still running, on another thread, after
     * giving up on it; start() then must not leave a server or a core behind.
     */
    private volatile boolean stopped;

    @Override public void start(ShellServices shell) {
        start(shell, DeviceConfig.CONTROL_PORT, BIND_ATTEMPTS);
    }

    /** The port and the attempt count are parameters so a JVM test can hold a port and expect the failure. */
    void start(ShellServices shell, final int port, int bindAttempts) {
        try {
            final CoreRuntime c = new CoreRuntime(shell, DeviceConfig.DEVICE_ID, DeviceConfig.PAYLOAD_VERSION,
                    net.kckern.daylight.api.PayloadState.dir(shell.payloadDir()));
            core = c;
            if (stopped) throw new IllegalStateException("stopped before start");
            for (String entry : DeviceConfig.CAPABILITY_ENTRIES) {
                c.add((Capability) Class.forName(entry).getDeclaredConstructor().newInstance());
            }
            c.start(new JSONObject(DeviceConfig.DEFAULTS_JSON));
            server = ControlServer.startWithRetry(() -> new ControlServer(port, c.router(), c.auth(), c.socket()), bindAttempts);
            if (server == null) {
                // A payload without its control port cannot be operated. Failing here makes the
                // shell go back to the previous payload, which may still be able to bind.
                shell.note("CONTROL", "control server failed to bind :" + port);
                throw new IllegalStateException("control port " + port + " could not be bound");
            }
            // stop() ran while the port was being bound and saw no server to stop.
            if (stopped) throw new IllegalStateException("stopped during start");
            shell.updateNotification(DeviceConfig.DEVICE_ID + " " + DeviceConfig.PAYLOAD_VERSION);
        } catch (Throwable e) {
            // Throwable: a missing class or method is an Error, and what already started must still be stopped.
            stop();
            // Throwing tells the shell this payload cannot run, so it rolls back.
            throw new IllegalStateException("payload cannot start: " + e, e);
        }
    }

    @Override public void stop() {
        stopped = true;
        ControlServer s = server;
        server = null;
        if (s != null) { try { s.stop(); } catch (Throwable ignored) { } }
        CoreRuntime c = core;
        core = null;
        if (c != null) { try { c.stop(); } catch (Throwable ignored) { } }
    }

    @Override public String version() { return DeviceConfig.PAYLOAD_VERSION; }

    @Override public void onShellComponent(String name, Object instance) {
        CoreRuntime c = core;
        if (c != null) c.onShellComponent(name, instance);
    }
}
