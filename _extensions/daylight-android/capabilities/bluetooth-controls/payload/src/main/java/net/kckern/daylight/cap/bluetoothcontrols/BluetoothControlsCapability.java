package net.kckern.daylight.cap.bluetoothcontrols;

import android.content.Context;

import net.kckern.daylight.core.Capability;
import net.kckern.daylight.core.CoreContext;
import net.kckern.daylight.core.Replies;
import net.kckern.daylight.core.Router;
import net.kckern.daylight.core.SettingsRegistry;
import net.kckern.daylight.core.spi.PairingDialogExemption;

import org.json.JSONObject;

public final class BluetoothControlsCapability implements Capability {
    private static final String[] ACTIONS = { "scan", "scan/stop", "pair", "unpair", "connect", "disconnect", "pairing", "power" };

    private CoreContext core;
    private volatile BluetoothController controller;
    private volatile RoleBluetoothPort roles;
    private Runnable closer;

    @Override public String name() { return "bluetooth-controls"; }

    @Override public void register(CoreContext core) {
        this.core = core;
        core.settings().declare("bluetooth.mode", SettingsRegistry.Type.STRING, "roles");
        // Opt in only after the kiosk permits the exact Bluetooth pairing dialog component.
        core.settings().declare("bluetooth.systemPairingDialog", SettingsRegistry.Type.BOOLEAN, false);

        core.router().route("GET", "/bluetooth", req -> respond(request("GET", "", null), false));
        for (final String action : ACTIONS) {
            core.router().route("POST", "/bluetooth/" + action, req -> respond(request("POST", action, req.body), true));
        }
        core.services().provide(PairingDialogExemption.class, () -> {
            RoleBluetoothPort p = roles;
            return p != null && p.isSystemPairingDialogAllowed();
        });
    }

    private JSONObject request(String method, String action, String body) {
        BluetoothController c = controller;
        if (c == null) return BluetoothController.error("unavailable", "Bluetooth controls are starting");
        return c.request(method, action, body);
    }

    /** Role mode answers 200 with ok true or false in the body, as the piano bridge did. */
    private Router.Response respond(JSONObject result, boolean action) {
        return Replies.json(result);
    }

    @Override public void start() {
        Context ctx = (Context) core.shell().context();
        // JVM tests boot every capability with no Android context: no adapter to manage.
        if (ctx == null) return;
        String mode = (String) core.settings().get("bluetooth.mode");
        if ("roles".equals(mode)) {
            RoleBluetoothPort port = new RoleBluetoothPort(ctx, core);
            port.start();
            roles = port;
            closer = port::close;
            controller = port.controller();
        } else {
            throw new IllegalArgumentException("bluetooth.mode must be 'roles' (got '" + mode + "')");
        }
    }

    @Override public void stop() {
        controller = null;
        roles = null;
        if (closer != null) { try { closer.run(); } catch (Throwable ignored) { } closer = null; }
    }
}
