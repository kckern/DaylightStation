package net.kckern.portalkeys.payload;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.hardware.usb.UsbRequest;
import android.os.Handler;
import android.os.HandlerThread;
import java.nio.ByteBuffer;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicLong;
import org.json.JSONArray;
import org.json.JSONObject;

final class UsbHidController {
    private static final String ACTION_PERMISSION = "net.kckern.portalkeys.USB_PERMISSION";
    private final Context context;
    private final UsbManager usb;
    private final HidBridgeServer bridge;
    private final UsbHidConfig config;
    private final UsbPermissionAutomator permissionAutomator;
    private final HandlerThread workerThread = new HandlerThread("portal-usb-hid");
    private Handler worker;
    private volatile boolean running;
    private volatile String state = "stopped";
    private volatile String lastError = "";
    private volatile UsbDevice activeDevice;
    private volatile UsbInterface activeInterface;
    private volatile UsbEndpoint activeEndpoint;
    private volatile UsbDeviceConnection connection;
    private volatile Thread readerThread;
    private final AtomicLong reports = new AtomicLong();
    private final AtomicLong decodedEvents = new AtomicLong();
    private final AtomicLong readErrors = new AtomicLong();
    private final BootKeyboardDecoder decoder = new BootKeyboardDecoder();

    UsbHidController(Context context, Object accessibilityService, HidBridgeServer bridge) {
        this.context = context.getApplicationContext();
        this.usb = (UsbManager) context.getSystemService(Context.USB_SERVICE);
        this.bridge = bridge;
        this.config = new UsbHidConfig(context);
        this.permissionAutomator = new UsbPermissionAutomator(accessibilityService);
    }

    void start() {
        if (running) return;
        running = true;
        workerThread.start();
        worker = new Handler(workerThread.getLooper());
        IntentFilter filter = new IntentFilter();
        filter.addAction(ACTION_PERMISSION);
        filter.addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED);
        filter.addAction(UsbManager.ACTION_USB_DEVICE_DETACHED);
        context.registerReceiver(receiver, filter);
        worker.post(scanTask);
    }

    void stop() {
        running = false;
        permissionAutomator.finish();
        try { context.unregisterReceiver(receiver); } catch (Throwable ignored) { }
        closeActive("stopped");
        if (worker != null) worker.removeCallbacksAndMessages(null);
        workerThread.quitSafely();
    }

    void retry() {
        if (worker != null) worker.post(new Runnable() {
            @Override public void run() { closeActive("retrying"); scanNow(); }
        });
    }

    void allow(int vendorId, int productId) { config.allow(vendorId, productId); retry(); }

    JSONObject status() {
        JSONObject out = Jsons.object("state", state, "lastError", lastError,
                "reports", reports.get(), "events", decodedEvents.get(),
                "readErrors", readErrors.get());
        JSONArray allow = new JSONArray();
        for (String id : config.entries()) allow.put(id);
        Jsons.put(out, "allow", allow);
        UsbDevice d = activeDevice;
        if (d != null) {
            Jsons.put(out, "device", Jsons.object("name", d.getDeviceName(),
                    "vendorId", d.getVendorId(), "productId", d.getProductId(),
                    "permission", usb != null && usb.hasPermission(d)));
        } else Jsons.put(out, "device", JSONObject.NULL);
        UsbInterface intf = activeInterface;
        if (intf != null) Jsons.put(out, "interface", Jsons.object(
                "id", intf.getId(), "class", intf.getInterfaceClass(),
                "subclass", intf.getInterfaceSubclass(), "protocol", intf.getInterfaceProtocol()));
        return out;
    }

    JSONObject inventory() {
        JSONArray devices = new JSONArray();
        if (usb != null) for (Map.Entry<String, UsbDevice> entry : usb.getDeviceList().entrySet()) {
            UsbDevice d = entry.getValue();
            JSONObject item = Jsons.object("path", entry.getKey(),
                    "vendorId", d.getVendorId(), "productId", d.getProductId(),
                    "allowed", config.allowed(d.getVendorId(), d.getProductId()),
                    "permission", usb.hasPermission(d));
            JSONArray interfaces = new JSONArray();
            for (int i = 0; i < d.getInterfaceCount(); i++) {
                UsbInterface intf = d.getInterface(i);
                interfaces.put(Jsons.object("id", intf.getId(),
                        "class", intf.getInterfaceClass(), "subclass", intf.getInterfaceSubclass(),
                        "protocol", intf.getInterfaceProtocol(), "endpoints", intf.getEndpointCount()));
            }
            Jsons.put(item, "interfaces", interfaces);
            devices.put(item);
        }
        return Jsons.object("ok", true, "devices", devices, "hid", status());
    }

    private final Runnable scanTask = new Runnable() {
        @Override public void run() {
            scanNow();
            if (running && worker != null) worker.postDelayed(this, 5000);
        }
    };

    private synchronized void scanNow() {
        if (!running || usb == null || connection != null) return;
        activeDevice = null;
        state = "waiting-for-device";
        for (UsbDevice device : usb.getDeviceList().values()) {
            if (!config.allowed(device.getVendorId(), device.getProductId())) continue;
            UsbInterface keyboard = findKeyboardInterface(device);
            UsbEndpoint endpoint = keyboard == null ? null : findInputEndpoint(keyboard);
            if (keyboard == null || endpoint == null) continue;
            activeDevice = device;
            activeInterface = keyboard;
            activeEndpoint = endpoint;
            if (!usb.hasPermission(device)) {
                state = "waiting-for-permission";
                requestPermission(device);
                return;
            }
            open(device, keyboard, endpoint);
            return;
        }
    }

    private void requestPermission(UsbDevice device) {
        Intent intent = new Intent(ACTION_PERMISSION).setPackage(context.getPackageName());
        PendingIntent pending = PendingIntent.getBroadcast(context, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        permissionAutomator.begin();
        usb.requestPermission(device, pending);
    }

    private synchronized void open(UsbDevice device, UsbInterface intf, UsbEndpoint endpoint) {
        UsbDeviceConnection opened = usb.openDevice(device);
        if (opened == null) { fail("openDevice returned null"); return; }
        if (!opened.claimInterface(intf, true)) {
            opened.close();
            fail("claimInterface failed");
            return;
        }
        connection = opened;
        activeDevice = device;
        activeInterface = intf;
        activeEndpoint = endpoint;
        state = "active";
        lastError = "";
        readerThread = new Thread(new Runnable() {
            @Override public void run() { readLoop(); }
        }, "portal-usb-reader");
        readerThread.start();
    }

    @SuppressWarnings("deprecation")
    private void readLoop() {
        UsbDeviceConnection current = connection;
        UsbEndpoint endpoint = activeEndpoint;
        if (current == null || endpoint == null) return;
        UsbRequest request = new UsbRequest();
        try {
            if (!request.initialize(current, endpoint)) throw new IllegalStateException("request init failed");
            int packetSize = Math.max(8, endpoint.getMaxPacketSize());
            while (running && current == connection) {
                ByteBuffer buffer = ByteBuffer.allocate(packetSize);
                if (!request.queue(buffer, packetSize)) throw new IllegalStateException("request queue failed");
                UsbRequest completed = current.requestWait();
                if (completed == null) throw new IllegalStateException("requestWait returned null");
                int count = buffer.position();
                if (count < 8) continue;
                byte[] report = new byte[8];
                buffer.flip();
                buffer.get(report, 0, 8);
                reports.incrementAndGet();
                List<HidKeyEvent> events = decoder.accept(report);
                decodedEvents.addAndGet(events.size());
                for (HidKeyEvent event : events) bridge.publish(event);
            }
        } catch (Throwable t) {
            if (running && current == connection) {
                readErrors.incrementAndGet();
                lastError = t.getClass().getSimpleName() + ": " + String.valueOf(t.getMessage());
                state = "read-failed";
            }
        } finally {
            try { request.close(); } catch (Throwable ignored) { }
            if (current == connection) closeActive(running ? "disconnected" : "stopped");
        }
    }

    private synchronized void closeActive(String nextState) {
        UsbDeviceConnection old = connection;
        connection = null;
        if (old != null) {
            try { if (activeInterface != null) old.releaseInterface(activeInterface); } catch (Throwable ignored) { }
            try { old.close(); } catch (Throwable ignored) { }
        }
        for (HidKeyEvent event : decoder.releaseAll()) bridge.publish(event);
        activeDevice = null;
        activeInterface = null;
        activeEndpoint = null;
        state = nextState;
    }

    private void fail(String message) { state = "open-failed"; lastError = message; }

    private static UsbInterface findKeyboardInterface(UsbDevice device) {
        for (int i = 0; i < device.getInterfaceCount(); i++) {
            UsbInterface intf = device.getInterface(i);
            if (intf.getInterfaceClass() == UsbConstants.USB_CLASS_HID
                    && intf.getInterfaceSubclass() == 1
                    && intf.getInterfaceProtocol() == 1) return intf;
        }
        return null;
    }

    private static UsbEndpoint findInputEndpoint(UsbInterface intf) {
        for (int i = 0; i < intf.getEndpointCount(); i++) {
            UsbEndpoint endpoint = intf.getEndpoint(i);
            if (endpoint.getDirection() == UsbConstants.USB_DIR_IN
                    && endpoint.getType() == UsbConstants.USB_ENDPOINT_XFER_INT) return endpoint;
        }
        return null;
    }

    private final BroadcastReceiver receiver = new BroadcastReceiver() {
        @Override public void onReceive(Context ignored, Intent intent) {
            String action = intent.getAction();
            UsbDevice device = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
            if (ACTION_PERMISSION.equals(action)) {
                permissionAutomator.finish();
                boolean granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false);
                state = granted ? "permission-granted" : "permission-denied";
                if (granted && worker != null) worker.post(new Runnable() {
                    @Override public void run() { scanNow(); }
                });
            } else if (UsbManager.ACTION_USB_DEVICE_DETACHED.equals(action)
                    && device != null && activeDevice != null
                    && device.getDeviceId() == activeDevice.getDeviceId()) {
                closeActive("detached");
            } else if (UsbManager.ACTION_USB_DEVICE_ATTACHED.equals(action) && worker != null) {
                worker.post(new Runnable() { @Override public void run() { scanNow(); } });
            }
        }
    };
}
