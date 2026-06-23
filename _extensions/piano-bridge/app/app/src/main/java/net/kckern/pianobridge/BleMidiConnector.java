package net.kckern.pianobridge;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.location.LocationManager;
import android.media.midi.MidiDevice;
import android.media.midi.MidiDeviceInfo;
import android.media.midi.MidiManager;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.SystemClock;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * BleMidiConnector — owns the BLE-MIDI link the kiosk depends on.
 *
 * The throwaway "MIDI BLE Connect" app proved the only viable path on Android:
 * a native component must call {@link MidiManager#openBluetoothDevice} to make a
 * BLE-MIDI peripheral exist to the system (Web MIDI in the WebView can't scan or
 * open BLE itself). This class does that — but correctly and unattended:
 *
 *  - connects the configured piano BY MAC (a {@code setDeviceAddress} scan filter
 *    inherently ignores the jamcorder and every other BLE device);
 *  - opens it via MidiManager — which both hands us the {@link MidiDevice} AND
 *    registers it system-wide, so the browser's Web MIDI sees it too
 *    (multi-client open confirmed on hardware);
 *  - auto-reconnects on drop (a {@link MidiManager.DeviceCallback} watches for the
 *    device being removed) and retries scans that time out;
 *  - starts on boot (via PianoBridgeService + BootReceiver).
 *
 * All BLE/MIDI callbacks run on a dedicated HandlerThread; state reads for the
 * /status endpoint are cheap volatiles.
 */
public class BleMidiConnector {

    private static final String TAG = "PianoBridge-BLE";

    public interface Listener {
        /** A MidiDevice for the target opened; wire its output port to your receiver. */
        void onMidiDeviceOpened(MidiDevice device, String name, String mac);
        /** The target dropped (or was closed); tear down the port. */
        void onMidiDeviceClosed();
    }

    public enum State { IDLE, SCANNING, CONNECTING, CONNECTED, NO_BLUETOOTH, NO_LOCATION, FAILED }

    private final Context ctx;
    private final DeviceConfig cfg;
    private final Listener listener;

    private final HandlerThread thread;
    private final Handler handler;

    private MidiManager midiManager;
    private BluetoothAdapter adapter;
    private BluetoothLeScanner scanner;

    private volatile State state = State.IDLE;
    private volatile String lastError = null;
    private volatile String connectedName = null;
    private volatile String connectedMac = null;
    private volatile long connectedSince = 0L;
    private volatile long lastStateChange = 0L;
    private volatile int reconnects = 0;

    private MidiDevice openDevice;
    private boolean running = false;
    private ScanCallback activeScan;

    public BleMidiConnector(Context ctx, DeviceConfig cfg, Listener listener) {
        this.ctx = ctx.getApplicationContext();
        this.cfg = cfg;
        this.listener = listener;
        this.thread = new HandlerThread("PianoBridge-BLE");
        this.thread.start();
        this.handler = new Handler(thread.getLooper());
    }

    /** Begin: acquire adapter, register the removal watcher, kick off a connect. */
    public void start() {
        handler.post(() -> {
            running = true;
            midiManager = (MidiManager) ctx.getSystemService(Context.MIDI_SERVICE);
            BluetoothManager bm = (BluetoothManager) ctx.getSystemService(Context.BLUETOOTH_SERVICE);
            adapter = bm != null ? bm.getAdapter() : BluetoothAdapter.getDefaultAdapter();
            if (midiManager != null) {
                midiManager.registerDeviceCallback(deviceWatcher, handler);
            }
            connectInternal();
        });
    }

    /** Force a fresh scan+connect (pbctl POST /connect). */
    public void connectNow() { handler.post(this::connectInternal); }

    /** Close the current connection and stop trying (pbctl POST /forget). */
    public void forget() {
        handler.post(() -> {
            stopScan();
            closeDevice();
            setState(State.IDLE, "forgotten");
        });
    }

    public void stop() {
        handler.post(() -> {
            running = false;
            stopScan();
            closeDevice();
            if (midiManager != null) midiManager.unregisterDeviceCallback(deviceWatcher);
        });
    }

    // --- connect flow ----------------------------------------------------

    private void connectInternal() {
        if (!running) return;
        // Cancel any queued retry + in-flight scan so overlapping connect cycles
        // can't pile up (a /connect racing a pending retry used to spawn parallel
        // scans and burn the Android 5-scans/30s throttle).
        handler.removeCallbacks(retryRunnable);
        stopScan();
        closeDevice();

        if (adapter == null || !adapter.isEnabled()) {
            setState(State.NO_BLUETOOTH, "Bluetooth is off");
            scheduleRetry();
            return;
        }
        // Android <12 returns no scan results unless location services are ON.
        if (!isLocationEnabled()) {
            setState(State.NO_LOCATION, "Location services are off (required for BLE scan)");
            scheduleRetry();
            return;
        }
        scanner = adapter.getBluetoothLeScanner();
        if (scanner == null) {
            setState(State.NO_BLUETOOTH, "no BLE scanner");
            scheduleRetry();
            return;
        }

        final String targetMac = cfg.targetMac();
        if (targetMac.isEmpty()) {
            setState(State.FAILED, "no targetMac in config");
            return;
        }

        // DIRECT-FIRST. Once the WIDI is bonded (or already GATT-connected, e.g. to
        // the jamcorder) it STOPS advertising, so a MAC-filtered scan never gets an
        // onScanResult for it — confirmed on hardware via /logcat: "Start Scan" →
        // 15s → "target not found". getRemoteDevice(MAC) + openBluetoothDevice
        // connects it by handle with no advertising required. If that hasn't reached
        // CONNECTED within a grace window, fall back to a scan (which handles the
        // advertising-but-unbonded case, e.g. a freshly power-cycled WIDI).
        BluetoothDevice direct = null;
        try { direct = adapter.getRemoteDevice(targetMac); }
        catch (IllegalArgumentException e) { Diag.log(TAG, "bad targetMac: " + targetMac); }

        if (direct != null) {
            Diag.log(TAG, "direct connect attempt → " + targetMac);
            openTarget(direct, /*scanOnFail=*/true);
            handler.postDelayed(() -> {
                if (running && state == State.CONNECTING) {
                    Diag.log(TAG, "direct connect still pending — falling back to scan");
                    startScan(targetMac);
                }
            }, 6000);
        } else {
            startScan(targetMac);
        }
    }

    /** Radio-filtered scan for the target MAC; opens it on first sighting. */
    private void startScan(final String targetMac) {
        if (!running || scanner == null) return;
        stopScan();
        setState(State.SCANNING, null);
        // Filter at the radio layer to ONLY the target MAC — blocklist is moot.
        List<ScanFilter> filters = Collections.singletonList(
                new ScanFilter.Builder().setDeviceAddress(targetMac).build());
        ScanSettings settings = new ScanSettings.Builder()
                .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build();

        activeScan = new ScanCallback() {
            @Override public void onScanResult(int type, ScanResult result) {
                BluetoothDevice dev = result.getDevice();
                if (dev == null) return;
                String mac = norm(dev.getAddress());
                if (cfg.blocklistMacs().contains(mac)) return; // belt-and-suspenders
                if (!mac.equals(targetMac)) return;
                stopScan();
                openTarget(dev, /*scanOnFail=*/false);
            }
            @Override public void onScanFailed(int errorCode) {
                setState(State.FAILED, "scan failed (" + errorCode + ")");
                scheduleRetry();
            }
        };
        try {
            scanner.startScan(filters, settings, activeScan);
        } catch (SecurityException e) {
            setState(State.FAILED, "scan permission denied (grant Location)");
            return;
        }
        // Timeout → retry.
        handler.postDelayed(() -> {
            if (state == State.SCANNING) {
                stopScan();
                setState(State.FAILED, "target not found in scan window");
                scheduleRetry();
            }
        }, cfg.scanTimeoutMs());
    }

    private void openTarget(BluetoothDevice dev, final boolean scanOnFail) {
        setState(State.CONNECTING, null);
        final String mac = norm(dev.getAddress());
        final String name = dev.getName() != null ? dev.getName() : cfg.targetName();
        try {
            midiManager.openBluetoothDevice(dev, device -> {
                if (device == null) {
                    if (scanOnFail) {
                        Diag.log(TAG, "direct open returned null — scanning");
                        startScan(cfg.targetMac());
                    } else {
                        setState(State.FAILED, "openBluetoothDevice returned null");
                        scheduleRetry();
                    }
                    return;
                }
                openDevice = device;
                connectedName = name;
                connectedMac = mac;
                connectedSince = SystemClock.elapsedRealtime();
                setState(State.CONNECTED, null);
                Log.i(TAG, "BLE-MIDI connected: " + name + " (" + mac + ")");
                listener.onMidiDeviceOpened(device, name, mac);
            }, handler);
        } catch (SecurityException e) {
            setState(State.FAILED, "connect permission denied");
            scheduleRetry();
        }
    }

    /** Watches MidiManager for our device disappearing → reconnect. */
    private final MidiManager.DeviceCallback deviceWatcher = new MidiManager.DeviceCallback() {
        @Override public void onDeviceRemoved(MidiDeviceInfo info) {
            String mac = bluetoothMac(info);
            if (mac != null && mac.equals(connectedMac)) {
                Log.w(TAG, "target removed from MidiManager — reconnecting");
                reconnects++;
                listener.onMidiDeviceClosed();
                closeDevice();
                // MUST reset state off CONNECTED here: scheduleRetry()'s retry guard
                // is `state != CONNECTED`, so leaving a stale CONNECTED wedges the
                // connector — the link drops but it never reconnects (observed:
                // CONNECTED / name=null / reconnects=1, dead).
                setState(State.FAILED, "device removed — reconnecting");
                if (running) scheduleRetry();
            }
        }
    };

    private final Runnable retryRunnable = new Runnable() {
        @Override public void run() { if (running && state != State.CONNECTED) connectInternal(); }
    };

    private void scheduleRetry() {
        if (!running) return;
        handler.removeCallbacks(retryRunnable); // collapse duplicate retries into one
        handler.postDelayed(retryRunnable, cfg.reconnectDelayMs());
    }

    private void stopScan() {
        if (scanner != null && activeScan != null) {
            try { scanner.stopScan(activeScan); } catch (Exception ignored) { }
        }
        activeScan = null;
    }

    private void closeDevice() {
        if (openDevice != null) {
            try { openDevice.close(); } catch (Exception ignored) { }
            openDevice = null;
        }
        connectedName = null;
        connectedMac = null;
        connectedSince = 0L;
    }

    // --- diagnostics -----------------------------------------------------

    /**
     * Active scan for ALL nearby BLE-MIDI devices (pbctl POST /scan). Collects
     * for `scanTimeoutMs` capped at ~6s, returns {name, mac, rssi} sorted by rssi.
     * Does not disturb an existing connection's reconnect loop beyond a brief
     * shared scan; callers should avoid running it mid-(re)connect.
     */
    public JSONArray scanForDevices(int ms) {
        final Map<String, ScanResult> found = new LinkedHashMap<>();
        if (adapter == null || !adapter.isEnabled() || adapter.getBluetoothLeScanner() == null) {
            return new JSONArray();
        }
        BluetoothLeScanner sc = adapter.getBluetoothLeScanner();
        ScanCallback cb = new ScanCallback() {
            @Override public void onScanResult(int type, ScanResult result) {
                if (result.getDevice() != null) found.put(result.getDevice().getAddress(), result);
            }
        };
        try {
            sc.startScan(Collections.<ScanFilter>emptyList(),
                    new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), cb);
            Thread.sleep(Math.min(Math.max(ms, 1000), 6000));
        } catch (Exception e) {
            Log.w(TAG, "scanForDevices failed", e);
        } finally {
            try { sc.stopScan(cb); } catch (Exception ignored) { }
        }
        List<ScanResult> list = new ArrayList<>(found.values());
        list.sort((a, b) -> Integer.compare(b.getRssi(), a.getRssi()));
        JSONArray arr = new JSONArray();
        for (ScanResult r : list) {
            try {
                BluetoothDevice d = r.getDevice();
                JSONObject o = new JSONObject();
                o.put("name", d.getName() == null ? JSONObject.NULL : d.getName());
                o.put("mac", norm(d.getAddress()));
                o.put("rssi", r.getRssi());
                o.put("isTarget", norm(d.getAddress()).equals(cfg.targetMac()));
                o.put("isBlocklisted", cfg.blocklistMacs().contains(norm(d.getAddress())));
                arr.put(o);
            } catch (JSONException ignored) { }
        }
        return arr;
    }

    public JSONObject status() {
        JSONObject o = new JSONObject();
        try {
            o.put("state", state.name());
            o.put("targetMac", cfg.targetMac());
            o.put("targetName", cfg.targetName());
            o.put("connectedName", connectedName == null ? JSONObject.NULL : connectedName);
            o.put("connectedMac", connectedMac == null ? JSONObject.NULL : connectedMac);
            o.put("connectedSeconds", connectedSince == 0 ? 0
                    : (SystemClock.elapsedRealtime() - connectedSince) / 1000);
            o.put("reconnects", reconnects);
            o.put("lastError", lastError == null ? JSONObject.NULL : lastError);
            o.put("bluetoothOn", adapter != null && adapter.isEnabled());
            o.put("locationOn", isLocationEnabled());
        } catch (JSONException ignored) { }
        return o;
    }

    public Handler handler() { return handler; }

    // --- helpers ---------------------------------------------------------

    private void setState(State s, String err) {
        state = s;
        lastStateChange = SystemClock.elapsedRealtime();
        if (err != null) { lastError = err; Diag.log(TAG, "state=" + s + " : " + err); }
        else Diag.log(TAG, "state=" + s);
    }

    private boolean isLocationEnabled() {
        LocationManager lm = (LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE);
        if (lm == null) return false;
        try { return lm.isLocationEnabled(); } catch (Exception e) {
            return lm.isProviderEnabled(LocationManager.GPS_PROVIDER)
                    || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
        }
    }

    private static String bluetoothMac(MidiDeviceInfo info) {
        if (info == null) return null;
        BluetoothDevice d = (BluetoothDevice) info.getProperties()
                .getParcelable(MidiDeviceInfo.PROPERTY_BLUETOOTH_DEVICE);
        return d == null ? null : norm(d.getAddress());
    }

    private static String norm(String mac) {
        return mac == null ? "" : mac.trim().toUpperCase(Locale.US);
    }
}
