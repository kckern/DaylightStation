package net.kckern.pianobridge;

import android.bluetooth.BluetoothA2dp;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothHeadset;
import android.bluetooth.BluetoothProfile;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.lang.reflect.Method;
import java.util.List;
import java.util.Locale;

/**
 * A2dpConnector — keep the piano's Bluetooth speaker (A2DP sink) connected.
 *
 * The MDG-400 exposes a classic-BT A2DP sink ("J2-USB Bluetooth") so the kiosk's
 * Web-Audio synth plays through the piano's own speakers. Android auto-reconnects
 * bonded A2DP devices, but on this rig it drops periodically (visible in the BT
 * log) and doesn't always come back, killing audio. This watchdog force-reconnects
 * it: it watches A2DP connection-state broadcasts and, on any disconnect (plus a
 * periodic sweep), calls BluetoothA2dp.connect() for the configured speaker MAC.
 *
 * connect() is @hide on API 29 but greylisted (@UnsupportedAppUsage), so it is
 * reachable by reflection from a targetSdk-29 app; getConnectedDevices() is public.
 * The speaker must be bonded once in Android Bluetooth settings first.
 */
public class A2dpConnector {

    private static final String TAG = "PianoBridge-A2DP";
    private static final long SWEEP_MS = 20000L;        // periodic "still connected?" check
    private static final long RECONNECT_DELAY_MS = 3000L; // debounce after a drop

    private final Context ctx;
    private final DeviceConfig cfg;
    private final HandlerThread thread;
    private final Handler handler;

    private BluetoothAdapter adapter;
    private volatile BluetoothA2dp proxy;
    private volatile BluetoothHeadset headset;
    private final HeadsetGuard headsetGuard = new HeadsetGuard(new HeadsetOps());
    private volatile boolean running = false;
    private volatile boolean stopped = false;
    private volatile String lastError = null;
    private volatile int reconnects = 0;
    private volatile long lastConnectAttempt = 0L;
    private volatile Runnable onStateChanged;
    // Every failed connect() also broadcasts DISCONNECTED; only a real drop of a working
    // link is an event (a wedged speaker would otherwise log one every 20 s, all night).
    private volatile boolean wasConnected = false;

    public A2dpConnector(Context ctx, DeviceConfig cfg) {
        this.ctx = ctx.getApplicationContext();
        this.cfg = cfg;
        this.thread = new HandlerThread("PianoBridge-A2DP");
        this.thread.start();
        this.handler = new Handler(thread.getLooper());
    }

    public void start() {
        handler.post(() -> {
            if (stopped) return;
            running = true;
            adapter = BluetoothAdapter.getDefaultAdapter();
            ctx.registerReceiver(stateReceiver,
                    new IntentFilter(BluetoothA2dp.ACTION_CONNECTION_STATE_CHANGED), null, handler);
            ctx.registerReceiver(headsetReceiver,
                    new IntentFilter(BluetoothHeadset.ACTION_CONNECTION_STATE_CHANGED), null, handler);
            if (adapter != null && adapter.isEnabled())
                adapter.getProfileProxy(ctx, profileListener, BluetoothProfile.A2DP);
            requestHeadsetProxy();
            scheduleSweep();
        });
    }

    public void stop() {
        stopped = true;
        running = false;
        handler.post(() -> {
            handler.removeCallbacksAndMessages(null);
            try { ctx.unregisterReceiver(stateReceiver); } catch (Exception ignored) { }
            try { ctx.unregisterReceiver(headsetReceiver); } catch (Exception ignored) { }
            if (proxy != null && adapter != null) {
                try { adapter.closeProfileProxy(BluetoothProfile.A2DP, proxy); } catch (Exception ignored) { }
            }
            if (headset != null && adapter != null) {
                try { adapter.closeProfileProxy(BluetoothProfile.HEADSET, headset); } catch (Exception ignored) { }
            }
            proxy = null;
            headset = null;
            onStateChanged = null; // drop the (now stale) guard reference
        });
        // Let the posted teardown run, then retire the HandlerThread so it doesn't leak
        // across reloadConfigAndReconnect() while still holding the old guard.
        thread.quitSafely();
    }

    /** Force an immediate reconnect attempt (pbctl POST /speaker). */
    public void connectNow() { handler.post(this::ensureConnected); }

    /** Force an A2DP disconnect (pbctl bootstrap). Reflection: disconnect() is @hide but greylisted. */
    public void disconnectNow() { handler.post(this::forceDisconnect); }

    /**
     * Rung 1 of the backend speaker ladder (POST /speaker/reconnect): drop whatever
     * half-open link the stack holds, then connect fresh. Plain connect() retries
     * cannot clear a wedge where the sink refuses L2CAP (SDP conn cnf 0x4).
     */
    public void reconnectNow() {
        handler.post(() -> {
            emit("bridge.a2dp.reconnect-requested", "info", null, null);
            forceDisconnect();
            handler.postDelayed(this::ensureConnected, 2000L);
        });
    }

    private void emit(String msg, String level, String key, Object value) {
        JSONObject d = new JSONObject();
        try {
            d.put("mac", cfg.speakerMac());
            d.put("reconnects", reconnects);
            if (key != null) d.put(key, value);
        } catch (JSONException ignored) { }
        LogEvents.emit(cfg, msg, level, d);
    }

    /** Force-disconnect the target speaker so the route falls back to the built-in speaker. */
    private void forceDisconnect() {
        if (adapter == null || !adapter.isEnabled()) { setError("bluetooth off"); return; }
        if (proxy == null) { adapter.getProfileProxy(ctx, profileListener, BluetoothProfile.A2DP); return; }
        final String mac = cfg.speakerMac();
        if (mac.isEmpty()) return;

        BluetoothDevice target;
        try { target = adapter.getRemoteDevice(mac); }
        catch (IllegalArgumentException e) { setError("bad speakerMac: " + mac); return; }

        if (!isConnected(target)) return; // already disconnected — nothing to do
        try {
            Method disconnect = BluetoothA2dp.class.getMethod("disconnect", BluetoothDevice.class);
            Object r = disconnect.invoke(proxy, target);
            Diag.log(TAG, "disconnect(" + mac + ") -> " + r);
        } catch (Throwable t) {
            setError("disconnect() failed: " + t.getClass().getSimpleName() + " " + t.getMessage());
        }
    }

    /** True iff the configured speaker MAC is currently A2DP-connected. */
    public boolean isTargetConnected() {
        String mac = cfg.speakerMac();
        if (adapter == null || mac.isEmpty()) return false;
        try { return isConnected(adapter.getRemoteDevice(mac)); }
        catch (Exception e) { return false; }
    }

    /** Optional hook fired (off the main thread) whenever A2DP state may have changed. */
    public void setOnStateChanged(Runnable r) { this.onStateChanged = r; }
    private void fireStateChanged() {
        Runnable r = onStateChanged;
        if (r != null) try { r.run(); } catch (Throwable t) { Log.w(TAG, "onStateChanged threw", t); }
    }

    private final BluetoothProfile.ServiceListener profileListener = new BluetoothProfile.ServiceListener() {
        @Override public void onServiceConnected(int profile, BluetoothProfile p) {
            if (profile == BluetoothProfile.HEADSET) {
                if (stopped) { if (adapter != null) adapter.closeProfileProxy(profile, p); return; }
                headset = (BluetoothHeadset) p;
                handler.post(A2dpConnector.this::guardHeadset);
                return;
            }
            if (profile != BluetoothProfile.A2DP) return;
            if (stopped) {
                if (adapter != null) adapter.closeProfileProxy(profile, p);
                return;
            }
            proxy = (BluetoothA2dp) p;
            Diag.log(TAG, "A2DP proxy ready");
            handler.post(A2dpConnector.this::ensureConnected);
        }
        @Override public void onServiceDisconnected(int profile) {
            if (profile == BluetoothProfile.A2DP) proxy = null;
            if (profile == BluetoothProfile.HEADSET) headset = null;
        }
    };

    private final BroadcastReceiver stateReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent intent) {
            BluetoothDevice dev = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
            if (dev == null || !norm(dev.getAddress()).equals(cfg.speakerMac())) return;
            int state = intent.getIntExtra(BluetoothA2dp.EXTRA_STATE, -1);
            if (state == BluetoothProfile.STATE_DISCONNECTED) {
                if (!running || !cfg.bluetoothAudioEnabled()) { fireStateChanged(); return; }
                reconnects++;
                Diag.log(TAG, "speaker disconnected — reconnecting (#" + reconnects + ")");
                if (wasConnected) emit("bridge.a2dp.disconnected", "warn", null, null);
                wasConnected = false;
                handler.postDelayed(A2dpConnector.this::ensureConnected, RECONNECT_DELAY_MS);
                fireStateChanged();
            } else if (state == BluetoothProfile.STATE_CONNECTED) {
                Diag.log(TAG, "speaker connected");
                emit("bridge.a2dp.connected", "info", null, null);
                wasConnected = true;
                lastError = null;
                fireStateChanged();
            }
        }
    };

    private final BroadcastReceiver headsetReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent intent) {
            BluetoothDevice dev = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
            if (dev == null || !norm(dev.getAddress()).equals(cfg.speakerMac())) return;
            if (intent.getIntExtra(BluetoothProfile.EXTRA_STATE, -1) == BluetoothProfile.STATE_CONNECTED) guardHeadset();
        }
    };

    /**
     * The HEADSET proxy dies with Bluetooth (the ladder's own BT cycle turns it off), and
     * nothing else would ask for it again — so every sweep re-requests it while it is gone.
     */
    private void requestHeadsetProxy() {
        if (headset == null && adapter != null && adapter.isEnabled())
            adapter.getProfileProxy(ctx, profileListener, BluetoothProfile.HEADSET);
    }

    /** Keep the speaker off HFP (see {@link HeadsetGuard}). Runs on the handler thread. */
    private void guardHeadset() {
        if (!running) return;
        requestHeadsetProxy();
        HeadsetGuard.Outcome o = headsetGuard.reconcile();
        if (o.capJustHit) {
            Diag.log(TAG, "HFP guard: disconnect cap reached; leaving HFP up for the rest of the hour");
            LogEvents.emit(cfg, "bridge.a2dp.hfp-capped", "warn", hfpData(o));
        }
        // Only a real change is an event: a refused priority write retried every sweep
        // must not become thousands of log lines a day.
        if (!o.changed) return;
        Diag.log(TAG, "HFP guard: priorityOff=" + o.priorityOff + " disconnected=" + o.disconnected);
        LogEvents.emit(cfg, "bridge.a2dp.hfp-disabled", "info", hfpData(o));
    }

    private JSONObject hfpData(HeadsetGuard.Outcome o) {
        JSONObject d = new JSONObject();
        try { d.put("mac", cfg.speakerMac()).put("priorityOff", o.priorityOff).put("disconnected", o.disconnected); }
        catch (JSONException ignored) { }
        return d;
    }

    /** Reflection onto BluetoothHeadset: get/setPriority are @SystemApi, disconnect is @hide (greylisted). */
    private final class HeadsetOps implements HeadsetGuard.Ops {
        private BluetoothDevice target() {
            String mac = cfg.speakerMac();
            if (adapter == null || mac.isEmpty()) return null;
            try { return adapter.getRemoteDevice(mac); } catch (IllegalArgumentException e) { return null; }
        }
        public boolean ready() { return headset != null && target() != null; }
        public boolean headsetConnected() {
            BluetoothHeadset h = headset; BluetoothDevice t = target();
            if (h == null || t == null) return false;
            try { return h.getConnectionState(t) == BluetoothProfile.STATE_CONNECTED; } catch (Exception e) { return false; }
        }
        public Boolean headsetPriorityOff() {
            try {
                Object p = BluetoothHeadset.class.getMethod("getPriority", BluetoothDevice.class).invoke(headset, target());
                return p instanceof Integer ? (Integer) p == 0 : null; // 0 = PRIORITY_OFF
            } catch (Throwable t) { return null; }
        }
        public boolean setHeadsetPriorityOff() {
            try {
                Object r = BluetoothHeadset.class.getMethod("setPriority", BluetoothDevice.class, int.class).invoke(headset, target(), 0);
                return Boolean.TRUE.equals(r);
            } catch (Throwable t) { Diag.log(TAG, "HFP setPriority refused: " + t.getClass().getSimpleName()); return false; }
        }
        public boolean disconnectHeadset() {
            try {
                Object r = BluetoothHeadset.class.getMethod("disconnect", BluetoothDevice.class).invoke(headset, target());
                return Boolean.TRUE.equals(r);
            } catch (Throwable t) { Diag.log(TAG, "HFP disconnect refused: " + t.getClass().getSimpleName()); return false; }
        }
    }

    private void scheduleSweep() {
        if (!running) return;
        handler.postDelayed(() -> {
            if (!running) return;
            ensureConnected();
            guardHeadset();
            fireStateChanged(); // gives the reconciler its <=20s convergence tick
            scheduleSweep();
        }, SWEEP_MS);
    }

    /** If the target speaker is bonded but not connected, force-connect it. */
    private void ensureConnected() {
        if (!running || !cfg.bluetoothAudioEnabled()) return;
        if (adapter == null || !adapter.isEnabled()) { setError("bluetooth off"); return; }
        if (proxy == null) { adapter.getProfileProxy(ctx, profileListener, BluetoothProfile.A2DP); return; }
        final String mac = cfg.speakerMac();
        if (mac.isEmpty()) return;

        BluetoothDevice target;
        try { target = adapter.getRemoteDevice(mac); }
        catch (IllegalArgumentException e) { setError("bad speakerMac: " + mac); return; }

        if (target.getBondState() != BluetoothDevice.BOND_BONDED) {
            setError("speaker not bonded (pair it in Bluetooth controls)");
            return;
        }
        if (isConnected(target)) { wasConnected = true; return; } // already good — nothing to do

        lastConnectAttempt = System.currentTimeMillis();
        try {
            Method connect = BluetoothA2dp.class.getMethod("connect", BluetoothDevice.class);
            Object r = connect.invoke(proxy, target);
            Diag.log(TAG, "connect(" + mac + ") -> " + r);
            lastError = null;
        } catch (Throwable t) {
            setError("connect() failed: " + t.getClass().getSimpleName() + " " + t.getMessage());
        }
    }

    private boolean isConnected(BluetoothDevice target) {
        BluetoothA2dp p = proxy;
        if (p == null) return false;
        try {
            List<BluetoothDevice> connected = p.getConnectedDevices();
            for (BluetoothDevice d : connected) {
                if (norm(d.getAddress()).equals(norm(target.getAddress()))) return true;
            }
        } catch (Exception e) { Log.w(TAG, "getConnectedDevices failed", e); }
        return false;
    }

    public JSONObject status() {
        JSONObject o = new JSONObject();
        try {
            String mac = cfg.speakerMac();
            boolean connected = isTargetConnected(); // single source of truth
            String bond = "unknown";
            if (adapter != null && !mac.isEmpty()) {
                try {
                    bond = bondName(adapter.getRemoteDevice(mac).getBondState());
                } catch (Exception ignored) { }
            }
            o.put("targetMac", mac);
            o.put("targetName", cfg.speakerName());
            o.put("connected", connected);
            o.put("bondState", bond);
            o.put("proxyReady", proxy != null);
            o.put("reconnects", reconnects);
            o.put("lastError", lastError == null ? JSONObject.NULL : lastError);
            // Last observation, not fresh binder calls: /status is polled every 30 s.
            HeadsetGuard.Snapshot h = headsetGuard.snapshot();
            o.put("hfpConnected", h.connected == null ? JSONObject.NULL : h.connected);
            o.put("hfpPriorityOff", h.priorityOff == null ? JSONObject.NULL : h.priorityOff);
            o.put("hfpDisconnects", h.disconnects);
            o.put("hfpPriorityRefused", h.priorityGivenUp);
            o.put("hfpCapped", h.capped);
            o.put("hfpProxyReady", headset != null);
        } catch (JSONException ignored) { }
        return o;
    }

    private static String bondName(int s) {
        switch (s) {
            case BluetoothDevice.BOND_BONDED: return "bonded";
            case BluetoothDevice.BOND_BONDING: return "bonding";
            default: return "none";
        }
    }

    private void setError(String e) {
        boolean changed = e != null && !e.equals(lastError);
        lastError = e;
        Diag.log(TAG, e);
        if (changed) emit("bridge.a2dp.error", "warn", "error", e);
    }

    private static String norm(String mac) { return mac == null ? "" : mac.trim().toUpperCase(Locale.US); }
}
