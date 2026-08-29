package net.kckern.portalkeys.payload;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.ParcelUuid;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

/** OTA-upgradable Bluetooth diagnostics and direct-bond escape hatch. */
final class BluetoothController {
    private static final int HID_HOST = 4;
    private static final int PRIORITY_AUTO_CONNECT = 1000;
    private final Context context;
    private final BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
    private final HandlerThread thread = new HandlerThread("portal-bluetooth");
    private Handler handler;
    private final Map<String, DeviceInfo> found = new LinkedHashMap<>();
    private volatile String scanState = "not-run";
    private volatile String scanError = "";
    private volatile String bondState = "idle";
    private volatile String hidState = "idle";
    private volatile ScanCallback leCallback;

    BluetoothController(Context context) { this.context = context.getApplicationContext(); }

    void start() {
        thread.start();
        handler = new Handler(thread.getLooper());
        IntentFilter filter = new IntentFilter();
        filter.addAction(BluetoothDevice.ACTION_FOUND);
        filter.addAction(BluetoothDevice.ACTION_BOND_STATE_CHANGED);
        filter.addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED);
        context.registerReceiver(receiver, filter);
    }

    void stop() {
        stopScan();
        try { context.unregisterReceiver(receiver); } catch (Throwable ignored) { }
        thread.quitSafely();
    }

    synchronized JSONObject scan(int durationMs) {
        if (adapter == null || !adapter.isEnabled()) {
            scanState = "adapter-unavailable";
            return status();
        }
        stopScan();
        found.clear();
        scanError = "";
        scanState = "scanning-classic-and-le-hid";
        try { adapter.startDiscovery(); } catch (Throwable t) { scanError = describe(t); }

        try {
            final BluetoothLeScanner scanner = adapter.getBluetoothLeScanner();
            if (scanner == null) throw new IllegalStateException("LE scanner unavailable");
            leCallback = new ScanCallback() {
                @Override public void onScanResult(int callbackType, ScanResult result) {
                    if (result != null && result.getDevice() != null) add(result.getDevice(), result.getRssi(), "le");
                }
                @Override public void onBatchScanResults(List<ScanResult> results) {
                    if (results != null) for (ScanResult r : results) onScanResult(0, r);
                }
                @Override public void onScanFailed(int errorCode) {
                    scanState = "le-failed-classic-continuing";
                    scanError = "LE errorCode=" + errorCode;
                }
            };
            // HID-over-GATT keyboards advertise the standard Human Interface Device
            // service. A concrete filter is a separate controller path from the prior
            // unfiltered scans and is worth testing on this vendor stack.
            List<ScanFilter> filters = new ArrayList<>();
            filters.add(new ScanFilter.Builder().setServiceUuid(
                    new ParcelUuid(UUID.fromString("00001812-0000-1000-8000-00805f9b34fb"))).build());
            ScanSettings settings = new ScanSettings.Builder()
                    .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                    .setReportDelay(0)
                    .build();
            scanner.startScan(filters, settings, leCallback);
        } catch (Throwable t) {
            scanState = "le-start-threw-classic-continuing";
            scanError = describe(t);
        }
        final int bounded = Math.max(1000, Math.min(60000, durationMs));
        handler.postDelayed(new Runnable() {
            @Override public void run() {
                stopScan();
                scanState = found.isEmpty() ? "completed-empty" : "completed-found";
            }
        }, bounded);
        return status();
    }

    synchronized JSONObject bond(String address) {
        if (adapter == null || !BluetoothAdapter.checkBluetoothAddress(address)) {
            return error("invalid Bluetooth address");
        }
        try {
            BluetoothDevice device = adapter.getRemoteDevice(address);
            bondState = "bond-requested:" + address;
            boolean started = device.createBond();
            if (!started) bondState = "bond-request-refused:" + device.getBondState();
            return Jsons.put(status(), "bondStarted", started);
        } catch (Throwable t) {
            bondState = "bond-threw";
            return error(describe(t));
        }
    }

    synchronized JSONObject connectHid(final String address) {
        if (adapter == null || !BluetoothAdapter.checkBluetoothAddress(address)) {
            return error("invalid Bluetooth address");
        }
        final BluetoothDevice device = adapter.getRemoteDevice(address);
        hidState = "proxy-requested:" + address;
        try {
            boolean requested = adapter.getProfileProxy(context, new BluetoothProfile.ServiceListener() {
                @Override public void onServiceConnected(int profile, BluetoothProfile proxy) {
                    try {
                        Method priority = proxy.getClass().getMethod("setPriority", BluetoothDevice.class, int.class);
                        priority.invoke(proxy, device, PRIORITY_AUTO_CONNECT);
                    } catch (Throwable ignored) { }
                    try {
                        Method connect = proxy.getClass().getMethod("connect", BluetoothDevice.class);
                        Object result = connect.invoke(proxy, device);
                        hidState = "connect-result:" + String.valueOf(result);
                    } catch (Throwable t) {
                        hidState = "connect-threw:" + describe(t);
                    } finally {
                        try { adapter.closeProfileProxy(HID_HOST, proxy); } catch (Throwable ignored) { }
                    }
                }
                @Override public void onServiceDisconnected(int profile) { hidState = "proxy-disconnected"; }
            }, HID_HOST);
            if (!requested) hidState = "proxy-request-refused";
            return Jsons.put(status(), "proxyRequested", requested);
        } catch (Throwable t) {
            hidState = "proxy-threw:" + describe(t);
            return error(describe(t));
        }
    }

    synchronized JSONObject status() {
        JSONArray bonded = new JSONArray();
        if (adapter != null) for (BluetoothDevice d : adapter.getBondedDevices()) bonded.put(deviceJson(d, 0, "bonded"));
        JSONArray seen = new JSONArray();
        for (DeviceInfo info : found.values()) seen.put(info.json());
        return Jsons.object("ok", true, "adapterPresent", adapter != null,
                "adapterEnabled", adapter != null && adapter.isEnabled(),
                "scanState", scanState, "scanError", scanError,
                "bondState", bondState, "hidState", hidState,
                "bonded", bonded, "found", seen);
    }

    private synchronized void add(BluetoothDevice d, int rssi, String transport) {
        found.put(d.getAddress(), new DeviceInfo(d, rssi, transport));
    }

    private synchronized void stopScan() {
        if (adapter == null) return;
        try { if (adapter.isDiscovering()) adapter.cancelDiscovery(); } catch (Throwable ignored) { }
        ScanCallback callback = leCallback;
        leCallback = null;
        if (callback != null) try {
            BluetoothLeScanner scanner = adapter.getBluetoothLeScanner();
            if (scanner != null) scanner.stopScan(callback);
        } catch (Throwable ignored) { }
    }

    private static JSONObject deviceJson(BluetoothDevice d, int rssi, String transport) {
        return Jsons.object("address", d.getAddress(), "name", String.valueOf(d.getName()),
                "type", d.getType(), "bondState", d.getBondState(),
                "rssi", rssi, "transport", transport);
    }

    private static JSONObject error(String message) { return Jsons.object("ok", false, "error", message); }
    private static String describe(Throwable t) {
        Throwable cause = t.getCause() == null ? t : t.getCause();
        return cause.getClass().getSimpleName() + ": " + String.valueOf(cause.getMessage());
    }

    private final BroadcastReceiver receiver = new BroadcastReceiver() {
        @Override public void onReceive(Context ignored, Intent intent) {
            BluetoothDevice device = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
            if (BluetoothDevice.ACTION_FOUND.equals(intent.getAction()) && device != null) {
                int rssi = intent.getShortExtra(BluetoothDevice.EXTRA_RSSI, Short.MIN_VALUE);
                add(device, rssi, "classic");
            } else if (BluetoothDevice.ACTION_BOND_STATE_CHANGED.equals(intent.getAction()) && device != null) {
                bondState = device.getAddress() + ":" + device.getBondState();
            } else if (BluetoothAdapter.ACTION_DISCOVERY_FINISHED.equals(intent.getAction())
                    && scanState.startsWith("scanning")) {
                scanState = "classic-finished-le-continuing";
            }
        }
    };

    private static final class DeviceInfo {
        final BluetoothDevice device;
        final int rssi;
        final String transport;
        DeviceInfo(BluetoothDevice device, int rssi, String transport) {
            this.device = device;
            this.rssi = rssi;
            this.transport = transport;
        }
        JSONObject json() { return deviceJson(device, rssi, transport); }
    }
}
