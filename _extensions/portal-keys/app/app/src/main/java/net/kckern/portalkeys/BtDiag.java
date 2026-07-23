package net.kckern.portalkeys;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Handler;
import android.os.Looper;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Answers, on the actual hardware, what this panel's Bluetooth can really do.
 *
 * Written because the indirect evidence disagreed with itself: the panel does
 * NOT declare `android.hardware.bluetooth_le`, which would normally mean no
 * BLE — yet GattService is running, and GATT *is* the BLE protocol layer. A
 * device with no BLE would not be running it. Guessing from feature flags was
 * about to send someone to buy the wrong hardware, so this asks the radio
 * directly.
 *
 * The three questions, in the order they decide things:
 *   1. Does the framework admit to BLE  (FEATURE_BLUETOOTH_LE)?
 *   2. Is there an LE scanner object at all?
 *   3. Does an actual LE scan return anything?
 *
 * (3) is the only one that settles it. A missing feature flag with a working
 * scanner means the flag is a vendor omission; a present scanner that finds
 * nothing over 15 seconds with a keyboard advertising a foot away means the
 * radio genuinely cannot do central-role LE.
 */
public class BtDiag {

    private final Context ctx;
    private final EventLog eventLog;
    private final Handler handler = new Handler(Looper.getMainLooper());

    private final Map<String, String> leFound = new LinkedHashMap<>();
    private volatile String leScanState = "not-run";
    private volatile String leScanError = "";

    public BtDiag(Context ctx, EventLog eventLog) {
        this.ctx = ctx;
        this.eventLog = eventLog;
    }

    /** Static capability report — no scanning. */
    public String snapshot() {
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        PackageManager pm = ctx.getPackageManager();

        boolean featureBt = pm.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH);
        boolean featureLe = pm.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE);

        String scanner = "n/a";
        boolean multiAdv = false;
        boolean offloadFilter = false;
        if (adapter != null) {
            try {
                BluetoothLeScanner s = adapter.getBluetoothLeScanner();
                scanner = (s == null) ? "null" : "present";
            } catch (Throwable t) {
                scanner = "threw:" + t.getClass().getSimpleName();
            }
            try { multiAdv = adapter.isMultipleAdvertisementSupported(); } catch (Throwable ignored) {}
            try { offloadFilter = adapter.isOffloadedFilteringSupported(); } catch (Throwable ignored) {}
        }

        StringBuilder bonded = new StringBuilder();
        if (adapter != null) {
            boolean first = true;
            for (BluetoothDevice d : adapter.getBondedDevices()) {
                if (!first) bonded.append(',');
                first = false;
                bonded.append("{\"mac\":\"").append(Json.escape(d.getAddress()))
                      .append("\",\"name\":\"").append(Json.escape(String.valueOf(d.getName())))
                      .append("\",\"type\":").append(d.getType())   // 1=CLASSIC 2=LE 3=DUAL
                      .append("}");
            }
        }

        StringBuilder found = new StringBuilder();
        boolean first = true;
        for (Map.Entry<String, String> e : leFound.entrySet()) {
            if (!first) found.append(',');
            first = false;
            found.append("{\"mac\":\"").append(Json.escape(e.getKey()))
                 .append("\",\"name\":\"").append(Json.escape(e.getValue())).append("\"}");
        }

        return "{"
                + "\"featureBluetooth\":" + featureBt + ","
                + "\"featureBluetoothLe\":" + featureLe + ","
                + "\"adapterPresent\":" + (adapter != null) + ","
                + "\"adapterEnabled\":" + (adapter != null && adapter.isEnabled()) + ","
                + "\"leScanner\":\"" + Json.escape(scanner) + "\","
                + "\"multipleAdvertisementSupported\":" + multiAdv + ","
                + "\"offloadedFilteringSupported\":" + offloadFilter + ","
                + "\"bonded\":[" + bonded + "],"
                + "\"leScanState\":\"" + Json.escape(leScanState) + "\","
                + "\"leScanError\":\"" + Json.escape(leScanError) + "\","
                + "\"leFound\":[" + found + "]"
                + "}";
    }

    /**
     * Run an LE scan for `ms`. THE decisive test: a BLE keyboard in pairing
     * mode advertises continuously, so if central-role LE works at all it will
     * appear here within seconds.
     */
    public synchronized String scanLe(final int ms) {
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null || !adapter.isEnabled()) {
            leScanState = "adapter-unavailable";
            return snapshot();
        }
        final BluetoothLeScanner scanner;
        try {
            scanner = adapter.getBluetoothLeScanner();
        } catch (Throwable t) {
            leScanState = "scanner-threw";
            leScanError = t.getClass().getSimpleName() + ": " + t.getMessage();
            return snapshot();
        }
        if (scanner == null) {
            leScanState = "scanner-null";
            return snapshot();
        }

        leFound.clear();
        leScanError = "";
        leScanState = "scanning";

        final ScanCallback cb = new ScanCallback() {
            @Override public void onScanResult(int type, ScanResult result) {
                BluetoothDevice d = result.getDevice();
                if (d != null) leFound.put(d.getAddress(), String.valueOf(d.getName()));
            }
            @Override public void onScanFailed(int errorCode) {
                leScanState = "failed";
                leScanError = "errorCode=" + errorCode;
                eventLog.add("btdiag-le-scan-failed " + errorCode);
            }
        };

        try {
            ScanSettings settings = new ScanSettings.Builder()
                    .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                    .build();
            scanner.startScan(null, settings, cb);
            // The modern scanner configures scan-filter parameters even when
            // no filter is supplied. This controller reports mMaxScanFilters=0,
            // and the stack logs `bte_scan_filt_param_cfg_evt, 23` and returns
            // SCAN_FAILED_INTERNAL_ERROR. The deprecated startLeScan() predates
            // filters entirely, so it is the documented way round exactly this.
            handler.postDelayed(new Runnable() {
                @Override public void run() {
                    if ("failed".equals(leScanState) || leFound.isEmpty()) startLegacyScan(ms);
                }
            }, 1500);
            eventLog.add("btdiag-le-scan-start " + ms + "ms");
            handler.postDelayed(new Runnable() {
                @Override public void run() {
                    try { scanner.stopScan(cb); } catch (Throwable ignored) {}
                    if ("scanning".equals(leScanState)) {
                        leScanState = leFound.isEmpty() ? "completed-empty" : "completed-found";
                    }
                    eventLog.add("btdiag-le-scan-done " + leScanState + " n=" + leFound.size());
                }
            }, ms);
        } catch (Throwable t) {
            leScanState = "start-threw";
            leScanError = t.getClass().getSimpleName() + ": " + t.getMessage();
        }
        return snapshot();
    }

    /**
     * Pre-filter LE scan API. Deprecated since API 21, and on this controller
     * the only one that works: it advertises zero scan filters, the modern
     * scanner configures filter params regardless, and the stack answers
     * `bte_scan_filt_param_cfg_evt, 23` -> SCAN_FAILED_INTERNAL_ERROR.
     * startLeScan predates filters entirely and sidesteps that path.
     */
    @SuppressWarnings("deprecation")
    private void startLegacyScan(final int ms) {
        final BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) return;
        final BluetoothAdapter.LeScanCallback legacy = new BluetoothAdapter.LeScanCallback() {
            @Override public void onLeScan(BluetoothDevice device, int rssi, byte[] scanRecord) {
                if (device != null) leFound.put(device.getAddress(), String.valueOf(device.getName()));
            }
        };
        boolean started;
        try {
            started = adapter.startLeScan(legacy);
        } catch (Throwable t) {
            leScanState = "legacy-threw";
            leScanError = t.getClass().getSimpleName() + ": " + t.getMessage();
            return;
        }
        leScanState = started ? "scanning-legacy" : "legacy-start-refused";
        eventLog.add("btdiag-le-legacy start=" + started);
        if (!started) return;
        handler.postDelayed(new Runnable() {
            @Override public void run() {
                try { adapter.stopLeScan(legacy); } catch (Throwable ignored) {}
                leScanState = leFound.isEmpty() ? "legacy-completed-empty" : "legacy-completed-found";
                eventLog.add("btdiag-le-legacy done " + leScanState + " n=" + leFound.size());
            }
        }, ms);
    }
}
