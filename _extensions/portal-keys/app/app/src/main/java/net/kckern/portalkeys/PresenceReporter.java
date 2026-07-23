package net.kckern.portalkeys;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothProfile;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Reports Bluetooth presence to the backend, which uses it as a physical
 * parental gate: the panel is usable while specific devices are connected.
 *
 * DESIGN NOTES — the two things that make this different from the obvious
 * implementation, both settled before this was written:
 *
 * 1. This reports ALL bonded devices and NO roles. It does not know which
 *    device matters or what its absence means. The backend owns that list.
 *    An earlier draft had the device list here as well as in school.yml, which
 *    is two sources of truth for one fact — replace a dead headset in one
 *    place and the gate strands at "disabled" with the new one connected.
 *
 * 2. This does NOT debounce. It reports the raw connection state plus
 *    `sinceMs`, how long that state has held. The backend applies the grace
 *    window, because grace is PER ROLE and only the backend knows roles.
 *    Debouncing here would have required shipping the device list here, i.e.
 *    problem 1. `sinceMs` gives the backend everything it needs without it
 *    having to see every ACL event.
 *
 * On API 28 (this panel is Android 9) BLUETOOTH is an install-time permission
 * — no runtime grant, nothing to re-approve after a reboot. Verified on the
 * device. HID_HOST is NOT public SDK despite a claim to the contrary; see
 * PROFILE_HID_HOST below.
 */
public class PresenceReporter {

    private static final String TAG = "PortalKeys";

    /**
     * HID_HOST is 4. It is NOT in the public SDK — I asserted it went public in
     * API 28 and the compiler disproved it, which is the whole reason this is a
     * literal with an explanation instead of a constant.
     *
     * Using the number is safe because `getProfileProxy` takes an int: an
     * unsupported profile returns false and we log it, rather than failing to
     * compile against a constant the SDK will not expose. HEADSET and A2DP are
     * public and used as such.
     */
    private static final int PROFILE_HID_HOST = 4;

    /** Profiles that mean "usable right now" for the devices we care about. */
    private static final int[] PROFILES = {
            PROFILE_HID_HOST,            // keyboards
            BluetoothProfile.HEADSET,    // SCO
            BluetoothProfile.A2DP,       // media — a headset can be bonded for one and not the other
    };

    private final Context ctx;
    private final Config config;
    private final EventLog eventLog;
    private final Handler handler = new Handler(Looper.getMainLooper());

    private final Map<Integer, BluetoothProfile> proxies = new HashMap<>();
    /** mac -> since when the CURRENT state has held. */
    private final Map<String, Long> stateSince = new HashMap<>();
    private final Map<String, Boolean> lastState = new HashMap<>();

    private final long startedAt = System.currentTimeMillis();
    private int seq = 0;
    private volatile String lastResult = "never-sent";
    private volatile String lastPayload = "";

    private BroadcastReceiver receiver;
    private Runnable heartbeat;

    public PresenceReporter(Context ctx, Config config, EventLog eventLog) {
        this.ctx = ctx;
        this.config = config;
        this.eventLog = eventLog;
    }

    public void start() {
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) {
            eventLog.add("presence-no-bluetooth-adapter");
            return;
        }

        for (int profile : PROFILES) {
            try {
                boolean ok = adapter.getProfileProxy(ctx, listener, profile);
                if (!ok) eventLog.add("presence-proxy-unsupported profile=" + profile);
            } catch (Throwable t) {
                // A refusal must degrade to the bonded + ACL-broadcast path
                // rather than take the whole reporter down.
                Log.w(TAG, "profile proxy refused: " + profile, t);
                eventLog.add("presence-proxy-refused profile=" + profile);
            }
        }

        // ACL broadcasts give the transition the instant it happens; the
        // heartbeat is the backstop, because they are not guaranteed and
        // because staleness is only meaningful if something arrives on a timer.
        receiver = new BroadcastReceiver() {
            @Override public void onReceive(Context c, Intent intent) {
                String action = intent.getAction();
                BluetoothDevice d = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                if (d != null && action != null) {
                    eventLog.add("presence-acl " + action.substring(action.lastIndexOf('.') + 1)
                            + " " + d.getAddress());
                }
                report();
            }
        };
        IntentFilter f = new IntentFilter();
        f.addAction(BluetoothDevice.ACTION_ACL_CONNECTED);
        f.addAction(BluetoothDevice.ACTION_ACL_DISCONNECTED);
        f.addAction(BluetoothAdapter.ACTION_STATE_CHANGED);
        ctx.registerReceiver(receiver, f);

        heartbeat = new Runnable() {
            @Override public void run() {
                report();
                handler.postDelayed(this, config.gateHeartbeatMs());
            }
        };
        handler.post(heartbeat);
        eventLog.add("presence-started");
    }

    public void stop() {
        if (receiver != null) { try { ctx.unregisterReceiver(receiver); } catch (Throwable ignored) {} }
        if (heartbeat != null) handler.removeCallbacks(heartbeat);
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter != null) {
            for (Map.Entry<Integer, BluetoothProfile> e : proxies.entrySet()) {
                try { adapter.closeProfileProxy(e.getKey(), e.getValue()); } catch (Throwable ignored) {}
            }
        }
        proxies.clear();
    }

    private final BluetoothProfile.ServiceListener listener = new BluetoothProfile.ServiceListener() {
        @Override public void onServiceConnected(int profile, BluetoothProfile proxy) {
            proxies.put(profile, proxy);
            eventLog.add("presence-proxy-ready profile=" + profile);
            report();
        }
        @Override public void onServiceDisconnected(int profile) {
            proxies.remove(profile);
        }
    };

    /** Connected on ANY profile counts as connected. */
    private boolean isConnected(String mac) {
        for (BluetoothProfile proxy : proxies.values()) {
            List<BluetoothDevice> devices = proxy.getConnectedDevices();
            if (devices == null) continue;
            for (BluetoothDevice d : devices) {
                if (mac.equalsIgnoreCase(d.getAddress())) return true;
            }
        }
        return false;
    }

    /** The current state of every bonded device, with how long it has held. */
    public String buildPayload() {
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        long now = System.currentTimeMillis();
        StringBuilder devices = new StringBuilder();

        if (adapter != null && adapter.isEnabled()) {
            Map<String, String> names = new LinkedHashMap<>();
            for (BluetoothDevice d : adapter.getBondedDevices()) names.put(d.getAddress(), d.getName());

            boolean first = true;
            for (Map.Entry<String, String> e : names.entrySet()) {
                String mac = e.getKey();
                boolean connected = isConnected(mac);
                Boolean was = lastState.get(mac);
                if (was == null || was != connected) {
                    lastState.put(mac, connected);
                    stateSince.put(mac, now);
                }
                long since = now - stateSince.getOrDefault(mac, now);

                if (!first) devices.append(',');
                first = false;
                devices.append("{\"mac\":\"").append(Json.escape(mac)).append("\",")
                       .append("\"name\":\"").append(Json.escape(String.valueOf(e.getValue()))).append("\",")
                       .append("\"connected\":").append(connected).append(',')
                       .append("\"sinceMs\":").append(since).append('}');
            }
        }

        return "{"
                + "\"at\":\"" + Json.escape(iso(now)) + "\","
                + "\"seq\":" + (++seq) + ","
                + "\"uptimeMs\":" + (now - startedAt) + ","
                + "\"version\":\"" + Json.escape(BuildConfig.VERSION_NAME) + "\","
                + "\"heartbeatMs\":" + config.gateHeartbeatMs() + ","
                + "\"btEnabled\":" + (adapter != null && adapter.isEnabled()) + ","
                + "\"devices\":[" + devices + "]"
                + "}";
    }

    private void report() {
        final String endpoint = config.gateEndpoint();
        final String payload = buildPayload();
        lastPayload = payload;
        if (endpoint.isEmpty()) { lastResult = "no-endpoint"; return; }

        new Thread(new Runnable() {
            @Override public void run() {
                HttpURLConnection conn = null;
                try {
                    conn = (HttpURLConnection) new URL(endpoint).openConnection();
                    conn.setRequestMethod("POST");
                    conn.setRequestProperty("Content-Type", "application/json");
                    String token = config.gateToken();
                    if (!token.isEmpty()) conn.setRequestProperty("X-Presence-Token", token);
                    conn.setConnectTimeout(5000);
                    conn.setReadTimeout(5000);
                    conn.setDoOutput(true);
                    try (OutputStream os = conn.getOutputStream()) {
                        os.write(payload.getBytes("UTF-8"));
                    }
                    lastResult = "http " + conn.getResponseCode();
                } catch (Throwable t) {
                    // A failed report is not an error condition on this side —
                    // it simply goes stale at the backend, which is the
                    // designed safe direction. Recorded so it is diagnosable.
                    lastResult = "error " + t.getClass().getSimpleName() + ": " + t.getMessage();
                } finally {
                    if (conn != null) conn.disconnect();
                }
            }
        }).start();
    }

    /** For GET /status, so pkctl can see presence without the backend. */
    public String toJson() {
        return "{\"lastResult\":\"" + Json.escape(lastResult) + "\","
                + "\"endpoint\":\"" + Json.escape(config.gateEndpoint()) + "\","
                + "\"last\":" + (lastPayload.isEmpty() ? "null" : lastPayload) + "}";
    }

    private static String iso(long ms) {
        java.text.SimpleDateFormat f =
                new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US);
        f.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
        return f.format(new java.util.Date(ms));
    }
}
