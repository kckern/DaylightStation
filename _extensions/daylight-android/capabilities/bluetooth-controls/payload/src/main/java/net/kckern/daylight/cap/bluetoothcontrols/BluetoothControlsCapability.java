package net.kckern.daylight.cap.bluetoothcontrols;

import android.content.Context;

import net.kckern.daylight.core.Capability;
import net.kckern.daylight.core.CoreContext;
import net.kckern.daylight.core.Diag;
import net.kckern.daylight.core.Replies;
import net.kckern.daylight.core.Router;
import net.kckern.daylight.core.SettingsRegistry;
import net.kckern.daylight.core.StatusBoard;
import net.kckern.daylight.core.spi.PairingDialogExemption;

import net.kckern.daylight.core.spi.PianoKioskTools;
import org.json.JSONObject;

public final class BluetoothControlsCapability implements Capability {
    private static final String[] ACTIONS = { "scan", "scan/stop", "pair", "unpair", "connect", "disconnect", "pairing", "power" };

    static final String MODE_ROLES = "roles", MODE_GAMEPAD = "gamepad";

    private CoreContext core;
    /** Why the controls are not running although the capability started. Null when they are, or before start. */
    private volatile String unavailable;
    private volatile BluetoothController controller;
    private volatile RoleBluetoothPort roles;
    private volatile boolean gamepad;
    private Runnable closer;

    @Override public String name() { return "bluetooth-controls"; }

    @Override public void register(CoreContext core) {
        this.core = core;
        core.services().provide(PianoKioskTools.Bluetooth.class, (action, body) ->
                request(action.isEmpty() ? "GET" : "POST", action, body));
        core.settings().declare("bluetooth.mode", SettingsRegistry.Type.STRING, MODE_ROLES,
                SettingsRegistry.oneOf(MODE_ROLES, MODE_GAMEPAD));
        // Opt in only after the kiosk permits the exact Bluetooth pairing dialog component.
        core.settings().declare("bluetooth.systemPairingDialog", SettingsRegistry.Type.BOOLEAN, false);

        core.router().route("GET", "/bluetooth", req -> respond(request("GET", "", null), false));
        for (final String action : ACTIONS) {
            core.router().route("POST", "/bluetooth/" + action, req -> respond(request("POST", action, req.body), true));
        }
        core.status().add(StatusBoard.Surface.STATUS, name(), o -> {
            String why = unavailable;
            o.put("bluetooth", new JSONObject()
                    .put("available", controller != null)
                    .put("mode", core.settings().get("bluetooth.mode"))
                    .put("error", why == null ? JSONObject.NULL : why));
        });
        core.services().provide(PairingDialogExemption.class, () -> {
            RoleBluetoothPort p = roles;
            return p != null && p.isSystemPairingDialogAllowed();
        });
    }

    private JSONObject request(String method, String action, String body) {
        BluetoothController c = controller;
        if (c == null) {
            String why = unavailable;
            return BluetoothController.error("unavailable", why == null ? "Bluetooth controls are starting" : why);
        }
        return c.request(method, action, body);
    }

    /** Role mode answers 200 with ok true or false in the body, as the piano bridge did. */
    private Router.Response respond(JSONObject result, boolean action) {
        if (!gamepad) return Replies.json(result);
        // The audio-bridge API: 200 state, 202 accepted, 400 invalid, 409 refused.
        int status = result.optBoolean("ok") ? (action ? 202 : 200)
                : "invalid_request".equals(result.optString("code")) ? 400 : 409;
        return Router.Response.json(status, result);
    }

    /** Test seam: a controller over a fake port. */
    void useForTest(BluetoothController controller, boolean gamepad) {
        this.controller = controller;
        this.gamepad = gamepad;
    }

    @Override public void start() {
        startIn((String) core.settings().get("bluetooth.mode"), (Context) core.shell().context());
    }

    /**
     * The registry refuses any other mode when it is set, so the last branch is not
     * expected to run. It reports and returns all the same: a capability that threw
     * here would take the control port down with it, and with the port gone the
     * setting could not be corrected.
     */
    void startIn(String mode, Context ctx) {
        unavailable = null;
        if (!MODE_ROLES.equals(mode) && !MODE_GAMEPAD.equals(mode)) {
            unavailable = "bluetooth.mode must be 'roles' or 'gamepad' (got '" + mode + "')";
            Diag.log("Daylight-Bluetooth", "not started: " + unavailable);
            return;
        }
        // JVM tests boot every capability with no Android context: no adapter to manage.
        if (ctx == null) return;
        if (MODE_ROLES.equals(mode)) {
            RoleBluetoothPort port = new RoleBluetoothPort(ctx, core);
            port.start();
            roles = port;
            closer = port::close;
            controller = port.controller();
        } else {
            GamepadBluetoothPort port = new GamepadBluetoothPort(ctx);
            port.start();
            closer = port::close;
            gamepad = true;
            controller = new BluetoothController(port, System::currentTimeMillis);
        }
    }

    @Override public void stop() {
        unavailable = null;
        controller = null;
        roles = null;
        gamepad = false;
        if (closer != null) { try { closer.run(); } catch (Throwable ignored) { } closer = null; }
    }
}
