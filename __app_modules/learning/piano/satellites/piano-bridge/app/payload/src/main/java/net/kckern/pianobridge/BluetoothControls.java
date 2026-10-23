package net.kckern.pianobridge;

import android.Manifest;
import android.bluetooth.BluetoothA2dp;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Android Bluetooth boundary owned by one payload, including discovery and pairing receivers. */
public final class BluetoothControls implements BluetoothController.Port {
    private static final long PAIRING_WINDOW_MS = 60000L;
    private final BridgeCore bridge;
    private final Context ctx;
    private final BluetoothAdapter adapter;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Map<String, BluetoothDevice> seen = new LinkedHashMap<>();
    private final Map<String, Integer> signal = new LinkedHashMap<>();
    private final BluetoothController controller;
    private BluetoothA2dp audio;
    private BluetoothLeScanner scanner;
    private ScanCallback scanCallback;
    private boolean closed;
    private boolean registered;
    private boolean scanRequested;
    private String requestedPairAddress;
    private long requestedPairUntil;
    private BleMidiConnector pairingPausedConnector;
    private JSONObject pairing;
    private String delegatedPairAddress;
    private long delegatedPairUntil;
    private String lastError;

    public BluetoothControls(BridgeCore bridge) {
        this.bridge = bridge;
        ctx = bridge.getContext().getApplicationContext();
        adapter = BluetoothAdapter.getDefaultAdapter();
        controller = new BluetoothController(this, System::currentTimeMillis);
    }

    public BluetoothController controller() { return controller; }

    public synchronized void start() {
        if (adapter == null || closed || registered) return;
        IntentFilter filter = new IntentFilter();
        filter.addAction(BluetoothDevice.ACTION_FOUND);
        filter.addAction(BluetoothDevice.ACTION_BOND_STATE_CHANGED);
        filter.addAction(BluetoothDevice.ACTION_PAIRING_REQUEST);
        filter.addAction(BluetoothAdapter.ACTION_STATE_CHANGED);
        filter.addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED);
        // Claim only our own unexpired pairing prompt below, before Settings' receiver.
        filter.setPriority(999);
        ctx.registerReceiver(receiver, filter, null, handler);
        registered = true;
        adapter.getProfileProxy(ctx, profileListener, BluetoothProfile.A2DP);
    }

    public synchronized void close() {
        closed = true;
        stopScan();
        handler.removeCallbacksAndMessages(null);
        if (requestedPairAddress != null) {
            try { invokeDevice(adapter.getRemoteDevice(requestedPairAddress), "cancelBondProcess"); }
            catch (Exception ignored) { }
        }
        clearPairing();
        if (registered) {
            try { ctx.unregisterReceiver(receiver); } catch (Exception ignored) { }
            registered = false;
        }
        if (adapter != null && audio != null) adapter.closeProfileProxy(BluetoothProfile.A2DP, audio);
        audio = null;
        seen.clear();
        signal.clear();
    }

    private final BluetoothProfile.ServiceListener profileListener = new BluetoothProfile.ServiceListener() {
        @Override public void onServiceConnected(int profile, BluetoothProfile proxy) {
            synchronized (BluetoothControls.this) {
                if (profile != BluetoothProfile.A2DP) return;
                if (closed) { adapter.closeProfileProxy(profile, proxy); return; }
                audio = (BluetoothA2dp) proxy;
            }
        }
        @Override public void onServiceDisconnected(int profile) {
            synchronized (BluetoothControls.this) { if (profile == BluetoothProfile.A2DP) audio = null; }
        }
    };

    @Override public synchronized JSONObject snapshot() throws Exception {
        expirePairing();
        boolean enabled = adapter != null && adapter.isEnabled();
        if (adapter != null) {
            for (BluetoothDevice device : adapter.getBondedDevices()) remember(device, null);
        }
        DeviceConfig cfg = bridge.getConfig();
        if (adapter != null && cfg != null) {
            rememberTarget(cfg.speakerMac());
            rememberTarget(cfg.targetMac());
        }
        List<BluetoothDevice> audioDevices = audio != null && enabled
                ? audio.getConnectedDevices() : Collections.emptyList();
        for (BluetoothDevice device : audioDevices) remember(device, null);
        BleMidiConnector ble = bridge.getBleConnector();
        JSONObject midi = ble != null ? ble.status() : null;
        String midiAddress = midi != null && "CONNECTED".equals(midi.optString("state"))
                ? midi.optString("connectedMac", "") : "";
        if (!midiAddress.isEmpty()) rememberTarget(midiAddress);
        JSONArray devices = new JSONArray();
        for (BluetoothDevice device : seen.values()) {
            String address = device.getAddress();
            JSONArray profiles = new JSONArray();
            for (BluetoothDevice connected : audioDevices) {
                if (address.equals(connected.getAddress())) { profiles.put("audio"); break; }
            }
            if (enabled && address.equals(midiAddress)) profiles.put("midi");
            String role = cfg != null && address.equals(cfg.speakerMac()) ? "audio"
                    : cfg != null && address.equals(cfg.targetMac()) ? "midi" : null;
            String name = device.getName();
            if (name == null && cfg != null) {
                if ("audio".equals(role)) name = cfg.speakerName();
                else if ("midi".equals(role)) name = cfg.targetName();
            }
            int type = device.getType();
            JSONObject value = new JSONObject().put("address", address)
                    .put("name", nullable(name))
                    .put("type", type == BluetoothDevice.DEVICE_TYPE_CLASSIC ? "classic"
                            : type == BluetoothDevice.DEVICE_TYPE_LE ? "ble"
                            : type == BluetoothDevice.DEVICE_TYPE_DUAL ? "dual" : "unknown")
                    .put("bond", bondName(device.getBondState()))
                    .put("connected", profiles.length() > 0).put("profiles", profiles)
                    .put("role", nullable(role));
            if (signal.containsKey(address)) value.put("rssi", signal.get(address));
            devices.put(value);
        }
        return new JSONObject().put("ok", true)
                .put("adapter", new JSONObject().put("supported", adapter != null).put("enabled", enabled)
                        // scanRequested is the bounded observation window, not proof a radio scan is active.
                        .put("discovering", enabled && (scanCallback != null || adapter.isDiscovering()))
                        .put("name", adapter == null ? JSONObject.NULL : nullable(adapter.getName())))
                .put("devices", devices).put("pairing", pairing == null ? JSONObject.NULL : new JSONObject(pairing.toString()))
                .put("lastError", nullable(lastError))
                .put("capabilities", new JSONObject().put("scan", adapter != null && hasAdmin())
                        .put("pair", adapter != null && hasAdmin()).put("unpair", adapter != null && hasAdmin() && hasDeviceMethod("removeBond"))
                        .put("audio", adapter != null && hasAudioMethod("connect"))
                        .put("midi", ctx.getSystemService(Context.MIDI_SERVICE) != null)
                        .put("pin", adapter != null && hasAdmin() && hasDeviceMethod("setPin", byte[].class))
                        .put("confirm", canConfirm())
                        .put("confirmationMode", confirmationMode()));
    }

    @Override public synchronized boolean scan(int durationMs) {
        if (durationMs < 1000 || durationMs > 30000 || !ready()) return false;
        LocationManager location = (LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE);
        if (location == null || !location.isLocationEnabled())
            return fail("Location services must be enabled for Bluetooth discovery on Android 10");
        stopScan();
        lastError = null;
        signal.clear();
        // Keep bonded devices and configured targets; discard stale nearby sightings.
        seen.clear();
        try {
            boolean classic = adapter.startDiscovery();
            scanner = adapter.getBluetoothLeScanner();
            scanRequested = true;
            if (scanner != null) {
                final ScanCallback callback = new ScanCallback() {
                    @Override public void onScanResult(int type, ScanResult result) {
                        synchronized (BluetoothControls.this) {
                            if (!closed && scanCallback == this) remember(result.getDevice(), result.getRssi());
                        }
                    }
                    @Override public void onBatchScanResults(List<ScanResult> results) {
                        for (ScanResult result : results) onScanResult(0, result);
                    }
                    @Override public void onScanFailed(int code) {
                        synchronized (BluetoothControls.this) {
                            if (scanCallback == this) {
                                scanCallback = null;
                                fail("BLE discovery failed (" + code + ")");
                            }
                        }
                    }
                };
                scanCallback = callback;
                scanner.startScan(Collections.emptyList(), new ScanSettings.Builder()
                        .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), callback);
            }
            if (!classic && scanner == null) { stopScan(); return fail("Bluetooth discovery was rejected"); }
            handler.postDelayed(scanTimeout, durationMs);
            Diag.log("PianoBridge-Bluetooth", "discovery started (" + durationMs + "ms)");
            return true;
        } catch (Exception e) { stopScan(); return fail("Bluetooth discovery could not start"); }
    }

    private final Runnable scanTimeout = () -> { synchronized (BluetoothControls.this) { stopScan(); } };

    @Override public synchronized boolean stopScan() {
        handler.removeCallbacks(scanTimeout);
        if (scanner != null && scanCallback != null) {
            try { scanner.stopScan(scanCallback); } catch (Exception ignored) { }
        }
        scanner = null;
        scanCallback = null;
        scanRequested = false;
        if (adapter != null) {
            try { if (adapter.isDiscovering()) adapter.cancelDiscovery(); } catch (Exception ignored) { }
        }
        return true;
    }

    @Override public synchronized boolean pair(String address) {
        if (!ready()) return false;
        expirePairing();
        if (requestedPairAddress != null && !requestedPairAddress.equals(address))
            return fail("Finish or cancel the current pairing request first");
        stopScan();
        BluetoothDevice device = adapter.getRemoteDevice(address);
        remember(device, null);
        if (device.getBondState() == BluetoothDevice.BOND_BONDED) return true;
        if (address.equals(requestedPairAddress) && device.getBondState() == BluetoothDevice.BOND_BONDING) return true;
        BleMidiConnector ble = bridge.getBleConnector();
        if (ble != null) {
            if (!ble.pauseDiscoveryForPairing()) {
                ble.resumeDiscoveryAfterPairing();
                return fail("MIDI discovery could not stop before pairing");
            }
            pairingPausedConnector = ble;
        }
        requestedPairAddress = address;
        requestedPairUntil = System.currentTimeMillis() + PAIRING_WINDOW_MS;
        pairing = null;
        delegatedPairAddress = null;
        delegatedPairUntil = 0;
        lastError = null;
        handler.removeCallbacks(pairingTimeout);
        handler.postDelayed(pairingTimeout, PAIRING_WINDOW_MS);
        boolean accepted = device.createBond();
        if (!accepted) { clearPairing(); return fail("Bluetooth rejected the pairing request"); }
        Diag.log("PianoBridge-Bluetooth", "pairing requested for " + address);
        return true;
    }

    @Override public synchronized boolean unpair(String address) throws Exception {
        if (!ready()) return false;
        stopScan();
        // Persist before removal: a bond-state broadcast must not trigger a watchdog reconnect.
        disableConfiguredRoles(address, null);
        if (address.equals(requestedPairAddress)) clearPairing();
        BluetoothDevice device = adapter.getRemoteDevice(address);
        if (device.getBondState() == BluetoothDevice.BOND_NONE) return true;
        boolean accepted = invokeDevice(device, "removeBond");
        if (!accepted) return fail("Bluetooth rejected unpairing");
        Diag.log("PianoBridge-Bluetooth", "unpairing requested for " + address);
        return true;
    }

    @Override public synchronized boolean connect(String address, String profile) throws Exception {
        if (!ready()) return false;
        stopScan();
        BluetoothDevice device = adapter.getRemoteDevice(address);
        if ("audio".equals(profile) && device.getBondState() != BluetoothDevice.BOND_BONDED)
            return fail("Pair the audio device before connecting");
        // Same device, same role: never rebuild the connectors (that drops a working
        // speaker AND BLE-MIDI). See ConnectPlan.
        DeviceConfig current = bridge.getConfig();
        boolean audioRole = "audio".equals(profile);
        A2dpConnector spk = bridge.getA2dpConnector();
        BleMidiConnector ble = bridge.getBleConnector();
        boolean connectedNow;
        if (audioRole) connectedNow = spk != null && spk.isTargetConnected();
        else {
            JSONObject st = ble != null ? ble.status() : null;
            connectedNow = st != null && "CONNECTED".equals(st.optString("state"))
                    && address.equalsIgnoreCase(st.optString("connectedMac", ""));
        }
        ConnectPlan.Action plan = current == null ? ConnectPlan.Action.RELOAD : ConnectPlan.decide(profile, address,
                audioRole ? current.speakerMac() : current.targetMac(),
                audioRole ? current.bluetoothAudioEnabled() : current.bluetoothMidiEnabled(),
                connectedNow, audioRole ? spk != null : ble != null);
        if (plan != ConnectPlan.Action.RELOAD) {
            if (plan == ConnectPlan.Action.NUDGE) {
                if (audioRole) spk.connectNow();
                else ble.connectNow();
            }
            // A renamed device is persisted, but without the teardown a reload would cost.
            String freshName = safeConfigName(device.getName());
            String knownName = audioRole ? current.speakerName() : current.targetName();
            if (!freshName.isEmpty() && !freshName.equals(knownName))
                DeviceConfig.writeOverride(ctx, (audioRole ? "speakerName: " : "targetName: ") + freshName + "\n");
            lastError = null;
            Diag.log("PianoBridge-Bluetooth", profile + " connect for " + address + " → " + plan + " (no teardown)");
            return true;
        }
        String name = safeConfigName(device.getName());
        String update = "audio".equals(profile)
                ? "speakerMac: " + address + "\nspeakerName: " + name + "\nbluetoothAudioEnabled: true\n"
                : "targetMac: " + address + "\ntargetName: " + name + "\nbluetoothMidiEnabled: true\n";
        DeviceConfig.writeOverride(ctx, update);
        bridge.reloadConfigAndReconnect();
        lastError = null;
        Diag.log("PianoBridge-Bluetooth", profile + " connection requested for " + address);
        return true;
    }

    @Override public synchronized boolean disconnect(String address, String profile) throws Exception {
        if (!ready()) return false;
        boolean configured = disableConfiguredRoles(address, profile);
        if ("audio".equals(profile)) {
            if (audio == null) return fail("Audio profile is not ready");
            BluetoothDevice device = adapter.getRemoteDevice(address);
            if (!audio.getConnectedDevices().contains(device)) return true;
            boolean accepted = Boolean.TRUE.equals(BluetoothA2dp.class.getMethod("disconnect", BluetoothDevice.class).invoke(audio, device));
            if (!accepted) return fail("Bluetooth rejected the audio disconnect");
        } else if (!configured) {
            // This payload owns only its configured BLE-MIDI device; never claim to close other apps' MIDI links.
            return fail("This device is not the configured MIDI connection");
        }
        lastError = null;
        return true;
    }

    private boolean disableConfiguredRoles(String address, String onlyProfile) throws Exception {
        DeviceConfig cfg = bridge.getConfig();
        if (cfg == null) return false;
        String update = "";
        if ((onlyProfile == null || "audio".equals(onlyProfile)) && address.equals(cfg.speakerMac()))
            update += "bluetoothAudioEnabled: false\n";
        if ((onlyProfile == null || "midi".equals(onlyProfile)) && address.equals(cfg.targetMac()))
            update += "bluetoothMidiEnabled: false\n";
        if (update.isEmpty()) return false;
        DeviceConfig.writeOverride(ctx, update);
        bridge.reloadConfigAndReconnect();
        return true;
    }

    @Override public synchronized boolean setEnabled(boolean enabled) {
        if (adapter == null || closed) return fail("Bluetooth is unavailable");
        stopScan();
        if (!enabled) clearPairing();
        if (adapter.isEnabled() == enabled) return true;
        boolean accepted = enabled ? adapter.enable() : adapter.disable();
        if (!accepted) return fail("Bluetooth power change was rejected");
        lastError = null;
        return true;
    }

    @Override public synchronized boolean reply(String address, boolean accept, String pin) throws Exception {
        expirePairing();
        // Recheck at the native boundary; a controller snapshot can race expiry or a bond event.
        if (!ready() || !address.equals(requestedPairAddress) || pairing == null)
            return fail("No active pairing request for this device");
        BluetoothDevice device = adapter.getRemoteDevice(address);
        String variant = pairing.optString("variant");
        boolean accepted;
        if (!accept) {
            accepted = invokeDevice(device, "cancelBondProcess");
            if (accepted) clearPairing();
        } else if ("pin".equals(variant)) {
            if (pin == null || pin.isEmpty() || pin.getBytes(StandardCharsets.UTF_8).length > 16
                    || pin.codePoints().anyMatch(Character::isISOControl)) return fail("Invalid PIN");
            accepted = Boolean.TRUE.equals(BluetoothDevice.class.getMethod("setPin", byte[].class)
                    .invoke(device, (Object) pin.getBytes(StandardCharsets.UTF_8)));
        } else if ("confirm".equals(variant) || "consent".equals(variant)) {
            if (canConfirm()) {
                accepted = Boolean.TRUE.equals(BluetoothDevice.class.getMethod("setPairingConfirmation", boolean.class)
                        .invoke(device, true));
            } else {
                // OEM dialogs may themselves require BLUETOOTH_PRIVILEGED to launch.
                // Their original system receiver opens them; this app cannot confirm for the user.
                return pairingError("system-dialog".equals(confirmationMode())
                        ? "Approve using the Android Bluetooth pairing dialog"
                        : "System pairing approval is not configured or the accessibility helper is unavailable");
            }
        } else {
            return pairingError("Complete the displayed code on the Bluetooth device");
        }
        if (!accepted) return pairingError("Bluetooth rejected the pairing response");
        lastError = null;
        return true;
    }

    private final BroadcastReceiver receiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            synchronized (BluetoothControls.this) {
                if (closed) return;
                try {
                    String action = intent.getAction();
                    BluetoothDevice device = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                    if (BluetoothDevice.ACTION_FOUND.equals(action) && scanRequested && device != null) {
                        Short rssi = intent.hasExtra(BluetoothDevice.EXTRA_RSSI)
                                ? intent.getShortExtra(BluetoothDevice.EXTRA_RSSI, Short.MIN_VALUE) : null;
                        remember(device, rssi == null ? null : (int) rssi);
                    } else if (BluetoothDevice.ACTION_PAIRING_REQUEST.equals(action) && device != null) {
                        expirePairing();
                        // Never claim, supply a PIN or confirm an unsolicited request.
                        if (!BluetoothController.ownsPairingRequest(requestedPairAddress, requestedPairUntil,
                                device.getAddress(), System.currentTimeMillis())) return;
                        int variant = intent.getIntExtra(BluetoothDevice.EXTRA_PAIRING_VARIANT, -1);
                        // Android 10: 0 PIN, 1 passkey input, 2 confirmation, 3 consent,
                        // 4 display passkey, 5 display PIN, 6 out-of-band consent, 7 16-digit PIN.
                        String kind = variant == 0 || variant == 7 ? "pin"
                                : variant == 2 ? "confirm" : variant == 3 || variant == 6 ? "consent" : "display";
                        int passkey = intent.getIntExtra(BluetoothDevice.EXTRA_PAIRING_KEY, -1);
                        pairing = new JSONObject().put("address", device.getAddress()).put("name", nullable(device.getName()))
                                .put("variant", kind).put("passkey", passkey < 0 ? JSONObject.NULL : passkey)
                                .put("expiresAtMs", requestedPairUntil).put("error", JSONObject.NULL);
                        if (("confirm".equals(kind) || "consent".equals(kind)) && "unsupported".equals(confirmationMode()))
                            pairingError("System pairing approval is not configured or the accessibility helper is unavailable");
                        else if (variant == 1) pairingError("Passkey entry is not supported by this Android API");
                        if ("system-dialog".equals(SystemPairingPolicy.pairingRoute(true, variant, confirmationMode()))) {
                            // Pair/createBond was explicit consent to start this scoped flow. Let
                            // Settings' privileged receiver open its protected pairing-only dialog;
                            // the user, not accessibility or this app, presses Android's Pair button.
                            delegatedPairAddress = requestedPairAddress;
                            delegatedPairUntil = requestedPairUntil;
                        } else if (isOrderedBroadcast()) abortBroadcast();
                    } else if (BluetoothDevice.ACTION_BOND_STATE_CHANGED.equals(action) && device != null) {
                        remember(device, null);
                        if (device.getAddress().equals(requestedPairAddress)) {
                            int bond = intent.getIntExtra(BluetoothDevice.EXTRA_BOND_STATE, BluetoothDevice.BOND_NONE);
                            if (bond == BluetoothDevice.BOND_BONDED) { clearPairing(); lastError = null; }
                            else if (bond == BluetoothDevice.BOND_NONE) { clearPairing(); fail("Pairing was cancelled or failed"); }
                        }
                    } else if (BluetoothAdapter.ACTION_STATE_CHANGED.equals(action)) {
                        if (intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, -1) == BluetoothAdapter.STATE_OFF) {
                            stopScan();
                            clearPairing();
                        }
                    }
                } catch (Exception e) { fail("Bluetooth event could not be processed"); }
            }
        }
    };

    private final Runnable pairingTimeout = () -> { synchronized (BluetoothControls.this) { expirePairing(); } };

    private void expirePairing() {
        if (requestedPairAddress != null && requestedPairUntil <= System.currentTimeMillis()) {
            // Cancel only the bond we explicitly requested. Do not retain a stale consent surface.
            try { invokeDevice(adapter.getRemoteDevice(requestedPairAddress), "cancelBondProcess"); }
            catch (Exception ignored) { }
            clearPairing();
            fail("Pairing request expired");
        }
    }

    private void clearPairing() {
        handler.removeCallbacks(pairingTimeout);
        requestedPairAddress = null;
        requestedPairUntil = 0;
        pairing = null;
        delegatedPairAddress = null;
        delegatedPairUntil = 0;
        if (pairingPausedConnector != null) {
            pairingPausedConnector.resumeDiscoveryAfterPairing();
            pairingPausedConnector = null;
        }
    }

    private void rememberTarget(String address) {
        if (address != null && !address.isEmpty()) {
            try { remember(adapter.getRemoteDevice(address), null); } catch (IllegalArgumentException ignored) { }
        }
    }

    private void remember(BluetoothDevice device, Integer rssi) {
        if (device == null) return;
        seen.put(device.getAddress(), device);
        if (rssi != null) signal.put(device.getAddress(), rssi);
    }

    private boolean ready() {
        if (closed || adapter == null) return fail("Bluetooth is unavailable");
        if (!adapter.isEnabled()) return fail("Bluetooth is off");
        return true;
    }

    private boolean hasAdmin() { return ctx.checkCallingOrSelfPermission(Manifest.permission.BLUETOOTH_ADMIN) == PackageManager.PERMISSION_GRANTED; }
    private boolean canConfirm() { return adapter != null && ctx.checkCallingOrSelfPermission("android.permission.BLUETOOTH_PRIVILEGED") == PackageManager.PERMISSION_GRANTED; }
    private String confirmationMode() {
        DeviceConfig config = bridge.getConfig();
        return SystemPairingPolicy.confirmationMode(canConfirm(),
                adapter != null && config != null && config.bluetoothSystemPairingDialogEnabled(), A11y.isConnected());
    }

    /** Transient guard exception: a live explicit delegation AND matching active dialog evidence. */
    synchronized boolean isSystemPairingDialogAllowed() {
        if (closed || pairing == null || !"system-dialog".equals(confirmationMode())
                || !SystemPairingPolicy.ownsDelegatedRequest(requestedPairAddress, requestedPairUntil,
                        delegatedPairAddress, delegatedPairUntil, System.currentTimeMillis())) return false;
        String name = pairing.isNull("name") ? null : pairing.optString("name", null);
        return A11y.isMatchingBluetoothPairingDialog(name, requestedPairAddress);
    }
    private boolean fail(String message) { lastError = message; return false; }
    private boolean pairingError(String message) {
        try { if (pairing != null) pairing.put("error", message); } catch (Exception ignored) { }
        return fail(message);
    }
    private static boolean invokeDevice(BluetoothDevice device, String method) throws Exception {
        return Boolean.TRUE.equals(BluetoothDevice.class.getMethod(method).invoke(device));
    }
    private static boolean hasDeviceMethod(String method, Class<?>... args) {
        try { BluetoothDevice.class.getMethod(method, args); return true; } catch (Exception e) { return false; }
    }
    private static boolean hasAudioMethod(String method) {
        try { BluetoothA2dp.class.getMethod(method, BluetoothDevice.class); return true; } catch (Exception e) { return false; }
    }
    private static Object nullable(String value) { return value == null ? JSONObject.NULL : value; }
    private static String safeConfigName(String value) {
        // DeviceConfig deliberately uses flat YAML: remote names must not inject keys/comments.
        if (value == null) return "Bluetooth device";
        return value.replaceAll("[\\p{Cntrl}#\"']", " ").trim();
    }
    private static String bondName(int value) {
        return value == BluetoothDevice.BOND_BONDED ? "bonded" : value == BluetoothDevice.BOND_BONDING ? "bonding" : "none";
    }
}
