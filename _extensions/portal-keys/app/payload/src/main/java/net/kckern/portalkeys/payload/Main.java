package net.kckern.portalkeys.payload;

import android.content.Context;
import net.kckern.portalkeys.api.Payload;
import net.kckern.portalkeys.api.ShellServices;

public final class Main implements Payload {
    static final String VERSION = "p11-policy-readback";
    private OpsServer ops;
    private HidBridgeServer hidBridge;
    private UsbHidController usbHid;
    private BluetoothController bluetooth;
    private VolumeBeepGuard beepGuard;
    private HomeWatchdog homeWatchdog;

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
            beepGuard = new VolumeBeepGuard(context, shell);
            beepGuard.start();
        } catch (Throwable t) {
            shell.note("PAYLOAD", "Volume beep guard start failed " + t);
            beepGuard = null;
        }
        try {
            homeWatchdog = new HomeWatchdog(context, shell);
            homeWatchdog.start();
            ops = new OpsServer(shell, usbHid, bluetooth, beepGuard, homeWatchdog);
            ops.start(0, true);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    @Override public void stop() {
        if (ops != null) ops.stop();
        if (homeWatchdog != null) homeWatchdog.stop();
        if (beepGuard != null) beepGuard.stop();
        if (bluetooth != null) bluetooth.stop();
        if (usbHid != null) usbHid.stop();
        if (hidBridge != null) hidBridge.stop();
        ops = null;
        homeWatchdog = null;
        beepGuard = null;
        bluetooth = null;
        usbHid = null;
        hidBridge = null;
    }

    @Override public String version() { return VERSION; }
}
