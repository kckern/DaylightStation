package net.kckern.audiobridge;

import android.Manifest;
import android.bluetooth.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.os.*;
import android.util.Log;
import org.json.*;
import java.util.*;

/** Android boundary; HID state is observed rather than inferred from command acceptance. */
public final class BluetoothControls implements BluetoothController.Port {
    private static final int HID_HOST = 4;
    private final Context ctx;
    private final BluetoothAdapter adapter;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Map<String, BluetoothDevice> seen = new LinkedHashMap<>();
    private BluetoothProfile hid;
    private String requestedAddress, lastError;
    private long pairingUntil;
    private JSONObject pairing;
    private boolean registered, closed;
    private final Runnable stopDiscovery = () -> stopScan();
    private final Runnable expirePairing = () -> { synchronized (BluetoothControls.this) { clearPairing(true); } };

    public BluetoothControls(Context ctx) {
        this.ctx = ctx.getApplicationContext();
        adapter = BluetoothAdapter.getDefaultAdapter();
    }
    public synchronized void start() {
        if (adapter == null || registered) return;
        IntentFilter filter = new IntentFilter();
        for (String action : new String[]{BluetoothDevice.ACTION_FOUND, BluetoothDevice.ACTION_BOND_STATE_CHANGED,
                BluetoothDevice.ACTION_PAIRING_REQUEST, BluetoothAdapter.ACTION_STATE_CHANGED,
                BluetoothAdapter.ACTION_DISCOVERY_FINISHED, "android.bluetooth.input.profile.action.CONNECTION_STATE_CHANGED"}) filter.addAction(action);
        filter.setPriority(999);
        ctx.registerReceiver(receiver, filter, null, handler);
        registered = true;
        requestProxy();
    }
    private void requestProxy() {
        if (closed || adapter == null || !hasPermission()) return;
        try { adapter.getProfileProxy(ctx, listener, HID_HOST); }
        catch (Exception e) { fail("HID profile is unavailable"); }
    }
    private final BluetoothProfile.ServiceListener listener = new BluetoothProfile.ServiceListener() {
        public void onServiceConnected(int profile, BluetoothProfile proxy) {
            synchronized (BluetoothControls.this) {
                if (closed) adapter.closeProfileProxy(profile, proxy); else hid = proxy;
            }
        }
        public void onServiceDisconnected(int profile) { synchronized (BluetoothControls.this) { hid = null; } }
    };
    private boolean hasPermission() {
        String permission = Build.VERSION.SDK_INT >= 31 ? Manifest.permission.BLUETOOTH_CONNECT : Manifest.permission.BLUETOOTH;
        return ctx.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }
    private boolean ready() {
        if (closed || adapter == null) return fail("Bluetooth is unavailable");
        if (!hasPermission()) return fail("Bluetooth permission is required during bridge setup");
        if (!adapter.isEnabled()) return fail("Bluetooth is turned off");
        return true;
    }
    /** Class bits distinguish gamepad/joystick from remotes which also report GAMEPAD input source. */
    static boolean isGamepadClass(int deviceClass) {
        return (deviceClass & 0x1f00) == 0x0500 && ((deviceClass & 0x3c) == 0x04 || (deviceClass & 0x3c) == 0x08);
    }
    private boolean manageable(BluetoothDevice device) {
        BluetoothClass klass = device.getBluetoothClass();
        return klass != null && isGamepadClass(klass.getDeviceClass());
    }
    @Override public synchronized JSONObject snapshot() throws Exception {
        boolean permitted = hasPermission();
        boolean enabled = adapter != null && permitted && adapter.isEnabled();
        if (adapter != null && permitted) for (BluetoothDevice d : adapter.getBondedDevices()) seen.put(d.getAddress(), d);
        List<BluetoothDevice> connected = enabled && hid != null ? hid.getConnectedDevices() : Collections.emptyList();
        JSONArray devices = new JSONArray();
        for (BluetoothDevice d : seen.values()) {
            boolean linked = connected.contains(d);
            int bond = d.getBondState();
            devices.put(new JSONObject().put("address", d.getAddress()).put("name", d.getName() == null ? "Unnamed device" : d.getName())
                    .put("type", d.getType() == BluetoothDevice.DEVICE_TYPE_LE ? "ble" : "classic")
                    .put("bond", bond == BluetoothDevice.BOND_BONDED ? "bonded" : bond == BluetoothDevice.BOND_BONDING ? "bonding" : "none")
                    .put("connected", linked).put("profiles", linked ? new JSONArray().put("input") : new JSONArray())
                    .put("manageable", manageable(d)));
        }
        return new JSONObject().put("ok", true)
                .put("adapter", new JSONObject().put("supported", adapter != null).put("enabled", enabled)
                        .put("discovering", enabled && adapter.isDiscovering()))
                .put("devices", devices).put("pairing", pairing == null ? JSONObject.NULL : new JSONObject(pairing.toString()))
                .put("lastError", lastError == null ? JSONObject.NULL : lastError)
                .put("capabilities", new JSONObject().put("scan", enabled && canScan()).put("pair", enabled)
                        .put("unpair", enabled && deviceMethod("removeBond"))
                        .put("input", enabled && hid != null && hidMethod("connect") && hidMethod("disconnect"))
                        .put("pin", enabled && deviceMethod("setPin", byte[].class))
                        .put("confirm", ctx.checkSelfPermission("android.permission.BLUETOOTH_PRIVILEGED") == PackageManager.PERMISSION_GRANTED));
    }
    private boolean canScan() {
        String permission = Build.VERSION.SDK_INT >= 31 ? Manifest.permission.BLUETOOTH_SCAN : Manifest.permission.ACCESS_FINE_LOCATION;
        return ctx.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }
    @Override public synchronized boolean scan(int durationMs) {
        if (!ready()) return false;
        if (!canScan()) return fail("Bluetooth discovery permission is required during bridge setup");
        LocationManager location = (LocationManager)ctx.getSystemService(Context.LOCATION_SERVICE);
        if (Build.VERSION.SDK_INT <= 30 && !location.isLocationEnabled()) return fail("Location services must be enabled during bridge setup for discovery");
        stopScan();
        seen.entrySet().removeIf(e -> e.getValue().getBondState() == BluetoothDevice.BOND_NONE);
        if (!adapter.startDiscovery()) return fail("Bluetooth discovery was not accepted");
        handler.postDelayed(stopDiscovery, durationMs);
        lastError = null;
        Log.i("AudioBridge", "bluetooth.scan.started");
        return true;
    }
    @Override public synchronized boolean stopScan() {
        handler.removeCallbacks(stopDiscovery);
        try { if (adapter != null && hasPermission() && adapter.isDiscovering()) adapter.cancelDiscovery(); }
        catch (SecurityException e) { return fail("Bluetooth discovery permission is unavailable"); }
        return true;
    }
    @Override public synchronized boolean pair(String address) {
        if (!ready()) return false;
        if (requestedAddress != null) return fail("Another pairing request is active");
        stopScan();
        BluetoothDevice d = seen.get(address);
        requestedAddress = address;
        pairingUntil = System.currentTimeMillis() + 60000;
        handler.postDelayed(expirePairing, 60000);
        if (!d.createBond()) { clearPairing(false); return fail("Pairing was not accepted"); }
        lastError = null;
        return true;
    }
    @Override public synchronized boolean unpair(String address) { return deviceAction(address, "removeBond"); }
    @Override public synchronized boolean connect(String address, String profile) { return hidAction(address, "connect"); }
    @Override public synchronized boolean disconnect(String address, String profile) { return hidAction(address, "disconnect"); }
    private boolean deviceAction(String address, String method) {
        if (!ready()) return false;
        try { boolean ok = Boolean.TRUE.equals(BluetoothDevice.class.getMethod(method).invoke(seen.get(address)));
            if (!ok) return fail("Bluetooth did not accept " + method); lastError = null; return true; }
        catch (Exception e) { return fail("This device does not permit " + method + " from the bridge"); }
    }
    private boolean hidAction(String address, String method) {
        if (!ready()) return false;
        if (hid == null) { requestProxy(); return fail("Controller connection service is starting; try again"); }
        stopScan();
        try { boolean ok = Boolean.TRUE.equals(hid.getClass().getMethod(method, BluetoothDevice.class).invoke(hid, seen.get(address)));
            if (!ok) return fail("Controller did not accept " + method + "; wake it and try again"); lastError = null; return true; }
        catch (Exception e) { return fail("This device does not permit controller " + method + " from the bridge"); }
    }
    @Override public synchronized boolean reply(String address, boolean accept, String pin) {
        if (!BluetoothController.ownsPairingRequest(requestedAddress, pairingUntil, address, System.currentTimeMillis())) return fail("Pairing request expired");
        BluetoothDevice d = seen.get(address);
        try {
            boolean ok;
            if (!accept) ok = Boolean.TRUE.equals(BluetoothDevice.class.getMethod("cancelBondProcess").invoke(d));
            else if (pin != null) ok = d.setPin(pin.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            else ok = d.setPairingConfirmation(true);
            if (ok) clearPairing(false); else fail("Pairing reply was not accepted");
            return ok;
        } catch (Exception e) { return fail("Pairing confirmation is restricted on this device"); }
    }
    private void clearPairing(boolean cancel) {
        if (cancel && requestedAddress != null) {
            try { BluetoothDevice.class.getMethod("cancelBondProcess").invoke(seen.get(requestedAddress)); } catch (Exception ignored) { }
        }
        handler.removeCallbacks(expirePairing);
        requestedAddress = null; pairingUntil = 0; pairing = null;
    }
    private boolean deviceMethod(String method, Class<?>... args) {
        try { BluetoothDevice.class.getMethod(method, args); return true; } catch (Exception e) { return false; }
    }
    private boolean hidMethod(String method) {
        try { if (hid == null) return false; hid.getClass().getMethod(method, BluetoothDevice.class); return true; } catch (Exception e) { return false; }
    }
    private boolean fail(String message) { lastError = message; Log.w("AudioBridge", "bluetooth.action.failed: " + message); return false; }
    private final BroadcastReceiver receiver = new BroadcastReceiver() {
        @Override public void onReceive(Context ignored, Intent intent) {
            synchronized (BluetoothControls.this) {
                if (closed) return;
                try {
                    BluetoothDevice d = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                    if (d != null) seen.put(d.getAddress(), d);
                    if (BluetoothAdapter.ACTION_STATE_CHANGED.equals(intent.getAction()) && adapter.isEnabled()) requestProxy();
                    if (d != null && BluetoothDevice.ACTION_PAIRING_REQUEST.equals(intent.getAction()) &&
                            BluetoothController.ownsPairingRequest(requestedAddress, pairingUntil, d.getAddress(), System.currentTimeMillis())) {
                        int variant = intent.getIntExtra(BluetoothDevice.EXTRA_PAIRING_VARIANT, -1);
                        pairing = new JSONObject().put("address", d.getAddress()).put("expiresAtMs", pairingUntil)
                                .put("variant", variant == 0 ? "pin" : "confirm");
                        // Keep the explicit request in our UX, never open Android Settings.
                        if (isOrderedBroadcast()) abortBroadcast();
                        if (variant != 0 && ctx.checkSelfPermission("android.permission.BLUETOOTH_PRIVILEGED") != PackageManager.PERMISSION_GRANTED)
                            fail("Pairing confirmation is restricted on this device");
                    }
                    if (d != null && BluetoothDevice.ACTION_BOND_STATE_CHANGED.equals(intent.getAction()) && d.getAddress().equals(requestedAddress)
                            && d.getBondState() != BluetoothDevice.BOND_BONDING) clearPairing(false);
                } catch (Exception e) { fail("Bluetooth state could not be updated"); }
            }
        }
    };
    public synchronized void close() {
        closed = true; stopScan(); clearPairing(true); handler.removeCallbacksAndMessages(null);
        if (registered) ctx.unregisterReceiver(receiver);
        registered = false;
        if (hid != null) adapter.closeProfileProxy(HID_HOST, hid);
        hid = null; seen.clear();
    }
}
