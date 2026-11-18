package net.kckern.daylight.cap.hidinput;

import android.content.Context;

import net.kckern.daylight.core.Capability;
import net.kckern.daylight.core.CoreContext;
import net.kckern.daylight.core.LiveSwitch;
import net.kckern.daylight.core.Replies;
import net.kckern.daylight.core.Router;
import net.kckern.daylight.core.StatusBoard;

import org.json.JSONObject;

/**
 * USB keyboards read at the endpoint, their events sent to the page on the control
 * WebSocket as {"type":"keyboard"}, plus the Bluetooth keyboard diagnostics portal-keys
 * carried. Route bodies are those of portal-keys' ops server and of its /btdiag and
 * /btscan; the Bluetooth routes sit under /hid/bluetooth because bluetooth-controls
 * owns /bluetooth.
 */
public final class HidInputCapability implements Capability {
    private CoreContext core;
    private volatile Context context;
    private volatile HidEventStream stream;
    private volatile UsbHidController usbHid;
    private volatile BluetoothController bluetooth;
    private volatile BtDiag btDiag;
    /**
     * hid.enabled: whether this app claims the USB keyboard. Off while portal-keys is
     * still installed and holds the same device; turned on at the Portal's cutover.
     */
    private LiveSwitch usbSwitch;

    @Override public String name() { return "hid-input"; }

    private static Router.Response unavailable(String what) { return Replies.json(Replies.err(what + " unavailable")); }

    private static int number(Router.Request req, String key) {
        try { return Integer.decode(req.query.get(key)); } catch (Exception e) { return -1; }
    }

    @Override public void register(CoreContext core) {
        this.core = core;
        usbSwitch = LiveSwitch.declare(core, "hid.enabled", new LiveSwitch.Part() {
            @Override public void acquire() { claimUsb(); }
            @Override public void release() { releaseUsb(); }
        });
        Router r = core.router();
        r.route("GET", "/input", req -> { Context c = context; return c == null ? unavailable("Input probe") : Replies.json(InputProbe.snapshot(c)); });
        r.route("GET", "/usb-hid", req -> { UsbHidController u = usbHid; return u == null ? unavailable("USB HID") : Replies.json(u.inventory()); });
        r.route("POST", "/usb-hid/retry", req -> {
            UsbHidController u = usbHid;
            if (u == null) return unavailable("USB HID");
            u.retry();
            return Replies.json(u.status());
        });
        r.route("POST", "/usb-hid/config", req -> {
            UsbHidController u = usbHid;
            if (u == null) return unavailable("USB HID");
            int vid = number(req, "vid"), pid = number(req, "pid");
            if (vid < 0 || pid < 0 || vid > 65535 || pid > 65535) return Replies.json(Replies.err("usage: vid=<0..65535> pid=<0..65535>"));
            u.allow(vid, pid);
            return Replies.json(u.status());
        });

        r.route("GET", "/hid/bluetooth", req -> { BluetoothController b = bluetooth; return b == null ? unavailable("Bluetooth") : Replies.json(b.status()); });
        r.route("GET", "/hid/bluetooth/diag", req -> { BluetoothController b = bluetooth; return b == null ? unavailable("Bluetooth") : Replies.json(b.diag()); });
        r.route("POST", "/hid/bluetooth/scan", req -> { BluetoothController b = bluetooth; return b == null ? unavailable("Bluetooth") : Replies.json(b.scan(Replies.intParam(req, "ms", 15000))); });
        r.route("POST", "/hid/bluetooth/bond", req -> { BluetoothController b = bluetooth; return b == null ? unavailable("Bluetooth") : Replies.json(b.bond(req.query.get("address"), req.query.get("transport"))); });
        r.route("POST", "/hid/bluetooth/scan-direct", req -> { BluetoothController b = bluetooth; return b == null ? unavailable("Bluetooth") : Replies.json(b.scanDirect(Replies.intParam(req, "ms", 15000))); });
        r.route("POST", "/hid/bluetooth/gatt-direct", req -> { BluetoothController b = bluetooth; return b == null ? unavailable("Bluetooth") : Replies.json(b.bindGatt(req.query.get("address"))); });
        r.route("POST", "/hid/bluetooth/gatt", req -> { BluetoothController b = bluetooth; return b == null ? unavailable("Bluetooth") : Replies.json(b.gattConnect(req.query.get("address"))); });
        r.route("POST", "/hid/bluetooth/gatt-disconnect", req -> { BluetoothController b = bluetooth; return b == null ? unavailable("Bluetooth") : Replies.json(b.gattDisconnect()); });
        r.route("POST", "/hid/bluetooth/connect-hid", req -> { BluetoothController b = bluetooth; return b == null ? unavailable("Bluetooth") : Replies.json(b.connectHid(req.query.get("address"))); });
        // What the radio can really do, asked of the radio (was /btdiag and /btscan).
        r.route("GET", "/hid/bluetooth/radio", req -> { BtDiag d = btDiag; return d == null ? unavailable("Bluetooth") : Replies.json(new JSONObject(d.snapshot())); });
        r.route("GET", "/hid/bluetooth/radio/scan", req -> {
            BtDiag d = btDiag;
            if (d == null) return unavailable("Bluetooth");
            return Replies.json(new JSONObject(d.scanLe(Math.max(1000, Math.min(60000, Replies.intParam(req, "ms", 15000))))));
        });

        core.status().add(StatusBoard.Surface.STATUS, name(), o -> {
            UsbHidController u = usbHid;
            HidEventStream s = stream;
            o.put("usbHid", u == null ? JSONObject.NULL : u.status());
            o.put("hidEvents", s == null ? 0 : s.events());
        });
    }

    @Override public void start() {
        Context shellContext = (Context) core.shell().context();
        // JVM tests boot every capability with no Android context: no USB, no radio.
        if (shellContext == null) return;
        Context ctx = shellContext.getApplicationContext();
        context = ctx;
        // Each part may fail alone, as in the portal-keys payload. The USB claim is
        // behind hid.enabled; the switch notes a failure and reports it in /status.
        usbSwitch.start();
        try {
            BluetoothController b = new BluetoothController(ctx);
            b.start();
            bluetooth = b;
        } catch (Throwable t) {
            core.shell().note("PAYLOAD", "Bluetooth diagnostics start failed " + t);
        }
        try {
            btDiag = new BtDiag(ctx, core.log());
        } catch (Throwable t) {
            core.shell().note("PAYLOAD", "Bluetooth radio diagnostics start failed " + t);
        }
    }

    /** The accessibility service as it is at the moment of asking, through the core's hub. */
    static UsbPermissionAutomator.ServiceSource accessibilitySource(final CoreContext core) {
        return () -> core.accessibility().service();
    }

    private void claimUsb() {
        Context ctx = context;
        if (ctx == null) throw new IllegalStateException("not started");
        HidEventStream s = new HidEventStream(core.socket());
        // Handed over as a source, not as the service: the service may bind after this,
        // and the USB permission dialog must still be confirmed then.
        UsbHidController u = new UsbHidController(ctx, accessibilitySource(core), s);
        stream = s;
        usbHid = u;
        u.start();
    }

    private void releaseUsb() {
        UsbHidController u = usbHid; usbHid = null; if (u != null) u.stop();
        HidEventStream s = stream; stream = null; if (s != null) s.stop();
    }

    @Override public void stop() {
        BluetoothController b = bluetooth; bluetooth = null; if (b != null) b.stop();
        if (usbSwitch != null) usbSwitch.stop();
        releaseUsb();
        btDiag = null;
        context = null;
    }
}
