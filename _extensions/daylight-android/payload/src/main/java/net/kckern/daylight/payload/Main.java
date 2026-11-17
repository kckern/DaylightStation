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
    private static final int SOCKET_READ_TIMEOUT_MS = 5000;
    private CoreRuntime core;
    private ControlServer server;

    @Override public void start(ShellServices shell) {
        try {
            core = new CoreRuntime(shell, DeviceConfig.DEVICE_ID, DeviceConfig.PAYLOAD_VERSION,
                    new File(shell.payloadDir(), "state"));
            for (String entry : DeviceConfig.CAPABILITY_ENTRIES) {
                core.add((Capability) Class.forName(entry).getDeclaredConstructor().newInstance());
            }
            core.start(new JSONObject(DeviceConfig.DEFAULTS_JSON));
            server = new ControlServer(DeviceConfig.CONTROL_PORT, core.router());
            server.start(SOCKET_READ_TIMEOUT_MS, false);
            shell.updateNotification(DeviceConfig.DEVICE_ID + " " + DeviceConfig.PAYLOAD_VERSION);
        } catch (Exception e) {
            stop();
            // Throwing tells the shell this payload cannot run, so it rolls back.
            throw new IllegalStateException("payload cannot start: " + e, e);
        }
    }

    @Override public void stop() {
        if (server != null) { try { server.stop(); } catch (Throwable ignored) { } server = null; }
        if (core != null) { try { core.stop(); } catch (Throwable ignored) { } core = null; }
    }

    @Override public String version() { return DeviceConfig.PAYLOAD_VERSION; }

    @Override public void onShellComponent(String name, Object instance) {
        // Phase 1 has no capability that uses a shell component. Phase 2 forwards these to the core.
    }
}
