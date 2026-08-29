package net.kckern.portalkeys.payload;

import android.content.Context;
import net.kckern.portalkeys.api.Payload;
import net.kckern.portalkeys.api.ShellServices;

public final class Main implements Payload {
    private OpsServer ops;
    private HidBridgeServer hidBridge;
    private UsbHidController usbHid;
    private BluetoothController bluetooth;

    @Override public void start(ShellServices shell) {
        Context context = ((Context) shell.context()).getApplicationContext();
        try {
            hidBridge = new HidBridgeServer();
            hidBridge.start(0, true);
            usbHid = new UsbHidController(context, shell.accessibilityService(), hidBridge);
            hidBridge.setController(usbHid);
            usbHid.start();
            shell.note("PAYLOAD", "USB HID loopback active :" + HidBridgeServer.PORT);
        } catch (Throwable t) {
            shell.note("PAYLOAD", "USB HID start failed " + t);
            if (usbHid != null) usbHid.stop();
            if (hidBridge != null) hidBridge.stop();
            usbHid = null;
            hidBridge = null;
        }
        try {
            bluetooth = new BluetoothController(context);
            bluetooth.start();
        } catch (Throwable t) {
            shell.note("PAYLOAD", "Bluetooth diagnostics start failed " + t);
            bluetooth = null;
        }
        try {
            ops = new OpsServer(shell, usbHid, bluetooth);
            ops.start(0, true);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    @Override public void stop() {
        if (ops != null) ops.stop();
        if (bluetooth != null) bluetooth.stop();
        if (usbHid != null) usbHid.stop();
        if (hidBridge != null) hidBridge.stop();
        ops = null;
        bluetooth = null;
        usbHid = null;
        hidBridge = null;
    }

    @Override public String version() { return "p2-bluetooth-usb-hid"; }
}
