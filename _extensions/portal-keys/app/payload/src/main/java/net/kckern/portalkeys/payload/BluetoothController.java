package net.kckern.portalkeys.payload;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.ServiceConnection;
import android.os.IBinder;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.ParcelUuid;
import java.lang.reflect.Constructor;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
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
    private volatile String bondReason = "";
    private volatile String pairingState = "none";
    private volatile String hidState = "idle";
    private volatile String gattState = "idle";
    private volatile String gattError = "";
    private volatile BluetoothGatt gatt;
    private final List<String> gattServices = new ArrayList<String>();
    private final List<String> gattReads = new ArrayList<String>();
    private volatile ScanCallback leCallback;
    private volatile Object iGatt;
    private volatile ServiceConnection gattConn;
    private volatile String bindState = "not-bound";
    private volatile String directState = "idle";
    private volatile String pendingAddress;
    private volatile BluetoothLeScanner directScanner;

    BluetoothController(Context context) { this.context = context.getApplicationContext(); }

    void start() {
        thread.start();
        handler = new Handler(thread.getLooper());
        IntentFilter filter = new IntentFilter();
        filter.addAction(BluetoothDevice.ACTION_FOUND);
        filter.addAction(BluetoothDevice.ACTION_BOND_STATE_CHANGED);
        filter.addAction(BluetoothDevice.ACTION_PAIRING_REQUEST);
        filter.addAction(BluetoothDevice.ACTION_ACL_CONNECTED);
        filter.addAction(BluetoothDevice.ACTION_ACL_DISCONNECTED);
        filter.addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED);
        context.registerReceiver(receiver, filter);
    }

    void stop() {
        stopScan();
        closeGatt();
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

    synchronized JSONObject bond(String address, String transport) {
        if (adapter == null || !BluetoothAdapter.checkBluetoothAddress(address)) {
            return error("invalid Bluetooth address");
        }
        try {
            BluetoothDevice device = adapter.getRemoteDevice(address);
            bondReason = "";
            pairingState = "none";
            int wanted = transportCode(transport);
            String how;
            boolean started;
            if (wanted < 0) {
                how = "createBond()";
                started = device.createBond();
            } else {
                // createBond(int) is @hide on this API level. TRANSPORT_AUTO picks BR/EDR for an
                // LE-only peripheral and times out in btif_dm_auth_cmpl_evt, so the transport has
                // to be named explicitly.
                how = "createBond(transport=" + wanted + ")";
                Method m = BluetoothDevice.class.getMethod("createBond", int.class);
                Object r = m.invoke(device, wanted);
                started = Boolean.TRUE.equals(r);
            }
            bondState = "bond-requested:" + address + " via " + how;
            if (!started) bondState = "bond-request-refused:" + device.getBondState() + " via " + how;
            return Jsons.put(Jsons.put(status(), "bondStarted", started), "bondVia", how);
        } catch (Throwable t) {
            bondState = "bond-threw";
            return error(describe(t));
        }
    }

    private static int transportCode(String name) {
        if (name == null || name.isEmpty() || "auto".equalsIgnoreCase(name)) return -1;
        if ("le".equalsIgnoreCase(name)) return BluetoothDevice.TRANSPORT_LE;
        if ("bredr".equalsIgnoreCase(name) || "classic".equalsIgnoreCase(name)) return BluetoothDevice.TRANSPORT_BREDR;
        return -1;
    }

    /**
     * Connects as a GATT central over LE and enumerates services. Reading the HID Report Map
     * is what forces encryption, which is how an LE bond actually gets negotiated; createBond
     * alone does not always drive SMP on this stack.
     */
    synchronized JSONObject gattConnect(String address) {
        if (adapter == null || !BluetoothAdapter.checkBluetoothAddress(address)) {
            return error("invalid Bluetooth address");
        }
        closeGatt();
        synchronized (gattServices) { gattServices.clear(); }
        synchronized (gattReads) { gattReads.clear(); }
        gattError = "";
        gattState = "connecting:" + address;
        try {
            BluetoothDevice device = adapter.getRemoteDevice(address);
            gatt = device.connectGatt(context, false, gattCallback, BluetoothDevice.TRANSPORT_LE);
            if (gatt == null) gattState = "connectGatt-returned-null";
        } catch (Throwable t) {
            gattState = "connect-threw";
            gattError = describe(t);
        }
        return status();
    }

    synchronized JSONObject gattDisconnect() {
        closeGatt();
        gattState = "closed";
        return status();
    }

    private void closeGatt() {
        BluetoothGatt g = gatt;
        gatt = null;
        if (g == null) return;
        try { g.disconnect(); } catch (Throwable ignored) { }
        try { g.close(); } catch (Throwable ignored) { }
    }

    private static final UUID HID_SERVICE = UUID.fromString("00001812-0000-1000-8000-00805f9b34fb");
    private static final UUID REPORT_MAP = UUID.fromString("00002a4b-0000-1000-8000-00805f9b34fb");

    private final BluetoothGattCallback gattCallback = new BluetoothGattCallback() {
        @Override public void onConnectionStateChange(BluetoothGatt g, int status, int newState) {
            gattState = "conn-state=" + newState + " status=" + status;
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                gattState = "connected status=" + status + " discovering";
                try { g.discoverServices(); } catch (Throwable t) { gattError = describe(t); }
            }
        }
        @Override public void onServicesDiscovered(BluetoothGatt g, int status) {
            gattState = "services-discovered status=" + status;
            List<BluetoothGattService> services = g.getServices();
            synchronized (gattServices) {
                gattServices.clear();
                for (BluetoothGattService s : services) {
                    StringBuilder sb = new StringBuilder(s.getUuid().toString());
                    for (BluetoothGattCharacteristic c : s.getCharacteristics()) {
                        sb.append("\n  char ").append(c.getUuid()).append(" props=0x")
                          .append(Integer.toHexString(c.getProperties()));
                    }
                    gattServices.add(sb.toString());
                }
            }
            BluetoothGattService hid = g.getService(HID_SERVICE);
            if (hid == null) { gattState = "services-discovered status=" + status + " no-hid-service"; return; }
            BluetoothGattCharacteristic map = hid.getCharacteristic(REPORT_MAP);
            if (map == null) { gattState = "hid-present no-report-map"; return; }
            gattState = "hid-present reading-report-map";
            try { g.readCharacteristic(map); } catch (Throwable t) { gattError = describe(t); }
        }
        @Override public void onCharacteristicRead(BluetoothGatt g, BluetoothGattCharacteristic c, int status) {
            byte[] v = c.getValue();
            // Status 5 = insufficient authentication, 15 = insufficient encryption: both mean the
            // stack should now be driving SMP, so the bond result is the thing to watch next.
            String note = c.getUuid() + " status=" + status + " len=" + (v == null ? -1 : v.length);
            synchronized (gattReads) { gattReads.add(note); }
            gattState = "read " + note;
        }
    };

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

    /**
     * BluetoothManagerService never obtained the IBluetoothGatt binder on this build, which is why
     * connectGatt() returns null and every LE scan fails with error 3. GattService itself is running
     * and publishes an intent filter for android.bluetooth.IBluetoothGatt, so bind it directly and
     * drive BluetoothGatt with our own binder instead of the framework's missing one.
     */
    /**
     * BluetoothLeScanner.startScan() reads IBluetoothManager.getBluetoothGatt() and posts
     * SCAN_FAILED_INTERNAL_ERROR (3) when it is null — the same single null that breaks connectGatt.
     * IBluetoothManager is an AIDL interface, so a dynamic proxy can answer that one call with the
     * binder we bound ourselves and delegate everything else to the real manager.
     */
    private Object managerProxy() throws Exception {
        Class<?> mgrClass = Class.forName("android.bluetooth.IBluetoothManager");
        Method getMgr = BluetoothAdapter.class.getDeclaredMethod("getBluetoothManager");
        getMgr.setAccessible(true);
        final Object realMgr = getMgr.invoke(adapter);
        return Proxy.newProxyInstance(mgrClass.getClassLoader(), new Class<?>[] { mgrClass },
                new InvocationHandler() {
                    @Override public Object invoke(Object p, Method m, Object[] a) throws Throwable {
                        if ("getBluetoothGatt".equals(m.getName())) return iGatt;
                        try { return m.invoke(realMgr, a); }
                        catch (InvocationTargetException e) { throw e.getCause(); }
                    }
                });
    }

    private BluetoothLeScanner injectedScanner() throws Exception {
        Object proxy = managerProxy();
        Constructor<?> best = null;
        for (Constructor<?> c : BluetoothLeScanner.class.getDeclaredConstructors()) {
            Class<?>[] t = c.getParameterTypes();
            if (t.length >= 1 && t[0].getName().endsWith("IBluetoothManager")) { best = c; break; }
        }
        if (best == null) throw new IllegalStateException("no BluetoothLeScanner constructor");
        best.setAccessible(true);
        Class<?>[] t = best.getParameterTypes();
        Object[] args = new Object[t.length];
        args[0] = proxy;
        for (int i = 1; i < t.length; i++) {
            if (t[i] == String.class) args[i] = context.getPackageName();
            else if (t[i] == Context.class) args[i] = context;
            else args[i] = null;
        }
        return (BluetoothLeScanner) best.newInstance(args);
    }

    /** Unfiltered LE scan through the injected binder. Also teaches the stack the address type. */
    synchronized JSONObject scanDirect(int durationMs) {
        if (iGatt == null) { scanState = "no-binder-bind-first"; return status(); }
        stopScan();
        found.clear();
        scanError = "";
        scanState = "scanning-direct-le";
        try {
            final BluetoothLeScanner scanner = injectedScanner();
            leCallback = new ScanCallback() {
                @Override public void onScanResult(int callbackType, ScanResult result) {
                    if (result != null && result.getDevice() != null) add(result.getDevice(), result.getRssi(), "le-direct");
                }
                @Override public void onBatchScanResults(List<ScanResult> results) {
                    if (results != null) for (ScanResult r : results) onScanResult(0, r);
                }
                @Override public void onScanFailed(int errorCode) {
                    scanState = "direct-scan-failed";
                    scanError = "errorCode=" + errorCode;
                }
            };
            ScanSettings settings = new ScanSettings.Builder()
                    .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).setReportDelay(0).build();
            scanner.startScan(new ArrayList<ScanFilter>(), settings, leCallback);
            directScanner = scanner;
        } catch (Throwable t) {
            scanState = "direct-scan-threw";
            scanError = describe(t);
            return status();
        }
        final int bounded = Math.max(1000, Math.min(60000, durationMs));
        handler.postDelayed(new Runnable() {
            @Override public void run() {
                BluetoothLeScanner s = directScanner;
                ScanCallback cb = leCallback;
                leCallback = null;
                directScanner = null;
                if (s != null && cb != null) try { s.stopScan(cb); } catch (Throwable ignored) { }
                scanState = found.isEmpty() ? "direct-completed-empty" : "direct-completed-found";
            }
        }, bounded);
        return status();
    }

    synchronized JSONObject bindGatt(String address) {
        pendingAddress = address;
        if (iGatt != null) return directConnect(address);
        try {
            Intent intent = new Intent("android.bluetooth.IBluetoothGatt");
            intent.setComponent(new ComponentName("com.android.bluetooth", "com.android.bluetooth.gatt.GattService"));
            gattConn = new ServiceConnection() {
                @Override public void onServiceConnected(ComponentName name, IBinder binder) {
                    try {
                        Class<?> stub = Class.forName("android.bluetooth.IBluetoothGatt$Stub");
                        Method asInterface = stub.getMethod("asInterface", IBinder.class);
                        iGatt = asInterface.invoke(null, binder);
                        bindState = iGatt == null ? "bound-null-interface" : "bound:" + iGatt.getClass().getName();
                    } catch (Throwable t) {
                        bindState = "asInterface-threw:" + describe(t);
                        return;
                    }
                    String want = pendingAddress;
                    if (want != null) directConnect(want);
                }
                @Override public void onServiceDisconnected(ComponentName name) {
                    iGatt = null;
                    bindState = "service-disconnected";
                }
            };
            boolean requested = context.bindService(intent, gattConn, Context.BIND_AUTO_CREATE);
            bindState = requested ? "bind-requested" : "bind-refused";
        } catch (Throwable t) {
            bindState = "bind-threw:" + describe(t);
        }
        return status();
    }

    private synchronized JSONObject directConnect(String address) {
        if (iGatt == null) { directState = "no-binder"; return status(); }
        if (adapter == null || !BluetoothAdapter.checkBluetoothAddress(address)) {
            directState = "invalid-address";
            return status();
        }
        closeGatt();
        synchronized (gattServices) { gattServices.clear(); }
        synchronized (gattReads) { gattReads.clear(); }
        try {
            BluetoothDevice device = adapter.getRemoteDevice(address);
            Constructor<?> ctor = null;
            for (Constructor<?> c : BluetoothGatt.class.getDeclaredConstructors()) {
                Class<?>[] p = c.getParameterTypes();
                if (p.length >= 3 && p[0].getName().endsWith("IBluetoothGatt")) { ctor = c; break; }
            }
            if (ctor == null) { directState = "no-usable-constructor"; return status(); }
            ctor.setAccessible(true);
            Class<?>[] types = ctor.getParameterTypes();
            Object[] args = new Object[types.length];
            args[0] = iGatt;
            for (int i = 1; i < types.length; i++) {
                if (types[i] == BluetoothDevice.class) args[i] = device;
                else if (types[i] == boolean.class) args[i] = Boolean.FALSE;
                else if (types[i] == int.class) args[i] = (i == 2) ? BluetoothDevice.TRANSPORT_LE : 1;
                else args[i] = null;
            }
            Object built = ctor.newInstance(args);
            gatt = (BluetoothGatt) built;
            directState = "constructed(" + types.length + " args)";
            Method connect = null;
            for (Method m : BluetoothGatt.class.getDeclaredMethods()) {
                if (!"connect".equals(m.getName())) continue;
                Class<?>[] p = m.getParameterTypes();
                if (p.length == 3 && BluetoothGattCallback.class.isAssignableFrom(p[1])) { connect = m; break; }
            }
            if (connect == null) { directState = "no-usable-connect"; return status(); }
            connect.setAccessible(true);
            Object result = connect.invoke(gatt, Boolean.TRUE, gattCallback, handler);
            directState = "connect=" + result;
            gattState = "direct-connect-issued";
        } catch (Throwable t) {
            directState = "direct-threw:" + describe(t);
        }
        return status();
    }

    /** Distinguishes "LE scanning is broken" from "LE is absent from this framework build". */
    JSONObject diag() {
        JSONObject out = Jsons.object("ok", true);
        try {
            android.content.pm.PackageManager pm = context.getPackageManager();
            Jsons.put(out, "featureBluetooth", pm.hasSystemFeature("android.hardware.bluetooth"));
            Jsons.put(out, "featureBluetoothLe", pm.hasSystemFeature("android.hardware.bluetooth_le"));
        } catch (Throwable t) { Jsons.put(out, "featureError", describe(t)); }
        try { Jsons.put(out, "leScannerNull", adapter == null || adapter.getBluetoothLeScanner() == null); }
        catch (Throwable t) { Jsons.put(out, "leScannerError", describe(t)); }
        try { Jsons.put(out, "leAdvertiserNull", adapter == null || adapter.getBluetoothLeAdvertiser() == null); }
        catch (Throwable t) { Jsons.put(out, "leAdvertiserError", describe(t)); }
        try { Jsons.put(out, "multipleAdvertisement", adapter != null && adapter.isMultipleAdvertisementSupported()); }
        catch (Throwable t) { Jsons.put(out, "multipleAdvertisementError", describe(t)); }
        try { Jsons.put(out, "offloadedFiltering", adapter != null && adapter.isOffloadedFilteringSupported()); }
        catch (Throwable t) { Jsons.put(out, "offloadedFilteringError", describe(t)); }
        try { Jsons.put(out, "offloadedScanBatching", adapter != null && adapter.isOffloadedScanBatchingSupported()); }
        catch (Throwable t) { Jsons.put(out, "offloadedScanBatchingError", describe(t)); }
        // connectGatt() returns null when IBluetoothManager.getBluetoothGatt() is null, which the
        // framework comments as "BLE is not supported". Read that binder directly to confirm.
        try {
            Method getMgr = BluetoothAdapter.class.getDeclaredMethod("getBluetoothManager");
            getMgr.setAccessible(true);
            Object mgr = getMgr.invoke(adapter);
            Jsons.put(out, "managerNull", mgr == null);
            if (mgr != null) {
                Method getGatt = mgr.getClass().getMethod("getBluetoothGatt");
                Object g = getGatt.invoke(mgr);
                Jsons.put(out, "iBluetoothGattNull", g == null);
                if (g != null) Jsons.put(out, "iBluetoothGatt", g.getClass().getName());
            }
        } catch (Throwable t) { Jsons.put(out, "managerProbeError", describe(t)); }
        try {
            android.bluetooth.BluetoothManager bm =
                    (android.bluetooth.BluetoothManager) context.getSystemService(Context.BLUETOOTH_SERVICE);
            Object server = bm == null ? null : bm.openGattServer(context, new android.bluetooth.BluetoothGattServerCallback() { });
            Jsons.put(out, "gattServerNull", server == null);
            if (server != null) ((android.bluetooth.BluetoothGattServer) server).close();
        } catch (Throwable t) { Jsons.put(out, "gattServerError", describe(t)); }
        return out;
    }

    synchronized JSONObject status() {
        JSONArray bonded = new JSONArray();
        if (adapter != null) for (BluetoothDevice d : adapter.getBondedDevices()) bonded.put(deviceJson(d, 0, "bonded"));
        JSONArray seen = new JSONArray();
        for (DeviceInfo info : found.values()) seen.put(info.json());
        return Jsons.object("ok", true, "adapterPresent", adapter != null,
                "adapterEnabled", adapter != null && adapter.isEnabled(),
                "scanState", scanState, "scanError", scanError,
                "bondState", bondState, "bondReason", bondReason,
                "pairingState", pairingState, "hidState", hidState,
                "gattState", gattState, "gattError", gattError,
                "bindState", bindState, "directState", directState,
                "gattServices", jsonArray(gattServices), "gattReads", jsonArray(gattReads),
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

    private static JSONArray jsonArray(List<String> values) {
        JSONArray out = new JSONArray();
        synchronized (values) { for (String v : values) out.put(v); }
        return out;
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
                int reason = intent.getIntExtra("android.bluetooth.device.extra.REASON", -1);
                if (reason != -1) bondReason = "reason=" + reason;
            } else if (BluetoothDevice.ACTION_PAIRING_REQUEST.equals(intent.getAction()) && device != null) {
                // Variant tells us whether a human has to type a passkey on the keyboard; the key
                // itself is what they would have to type, so it is state we must surface, not hide.
                int variant = intent.getIntExtra(BluetoothDevice.EXTRA_PAIRING_VARIANT, -1);
                int key = intent.getIntExtra(BluetoothDevice.EXTRA_PAIRING_KEY, -1);
                pairingState = device.getAddress() + " variant=" + variant + (key == -1 ? "" : " passkey=" + key);
            } else if (BluetoothDevice.ACTION_ACL_CONNECTED.equals(intent.getAction()) && device != null) {
                pairingState = pairingState + " | acl-connected:" + device.getAddress();
            } else if (BluetoothDevice.ACTION_ACL_DISCONNECTED.equals(intent.getAction()) && device != null) {
                pairingState = pairingState + " | acl-disconnected:" + device.getAddress();
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
