package net.kckern.daylight.cap.leasegate;

import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;

import net.kckern.daylight.core.spi.PackageGate;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Supplier;

import javax.net.ssl.HttpsURLConnection;

/**
 * Polls for a lease and enforces it locally. Network I/O can never block the local
 * expiry tick. The tick, poll and accept logic is supervision-guard's GuardService,
 * with DevicePolicyManager replaced by PackageGate. Until something provides a ready
 * PackageGate the loop reports ready:false and treats the gate as closed.
 */
final class LeaseLoop {
    private static final String TAG = "SupervisionGuard";

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private final LeaseOrder order;
    private final LeaseDeadline lease;
    private final Supplier<PackageGate> gate;
    private final String endpoint, credential, target;
    private final PowerManager.WakeLock awake;
    /** Whether this device can have a device owner at all (android.software.device_admin). */
    private final boolean deviceAdminFeature;
    private volatile boolean ready = false, blocked = true;
    private boolean fetching = false;
    private volatile boolean stopped = false;

    LeaseLoop(Context ctx, LeaseOrder order, Supplier<PackageGate> gate, String endpoint, String credential, String target) {
        this.order = order;
        this.lease = order.load();
        this.gate = gate;
        boolean valid = validConfig(endpoint, credential, target, ctx.getPackageName());
        if (!valid) Log.w(TAG, "Local enforcement not provisioned");
        this.endpoint = valid ? endpoint : null;
        this.credential = valid ? credential : null;
        this.target = valid ? target : null;
        this.awake = ctx.getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Daylight:supervision-lease");
        this.awake.setReferenceCounted(false);
        this.deviceAdminFeature = ctx.getPackageManager().hasSystemFeature(PackageManager.FEATURE_DEVICE_ADMIN);
    }

    static boolean validConfig(String endpoint, String credential, String target, String ownPackage) {
        try {
            URL url = new URL(endpoint);
            return "https".equals(url.getProtocol()) && url.getUserInfo() == null && url.getQuery() == null
                    && credential != null && credential.length() >= 32
                    && target != null && target.matches("[a-zA-Z][a-zA-Z0-9_]*(\\.[a-zA-Z][a-zA-Z0-9_]*)+")
                    && !target.equals(ownPackage);
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Why the target package cannot be hidden here, or null when it can. Hiding a
     * package takes a device owner, and a device without the device-admin feature can
     * never have one.
     */
    static String hidingUnsupportedReason(boolean hasGate, boolean gateReady, boolean deviceAdminFeature) {
        if (hasGate && gateReady) return null;
        if (!deviceAdminFeature) {
            return "this device has no android.software.device_admin feature, so no app can be device owner and no package can be hidden";
        }
        if (hasGate) return "the package gate is not ready: this app is not device owner";
        return "no capability in this build provides a package gate";
    }

    void start() {
        enforce(true);
        handler.post(tick);
        handler.post(poll);
    }

    void stop() {
        stopped = true;
        handler.removeCallbacksAndMessages(null);
        lease.revoke();
        enforce(true);
        network.shutdownNow();
    }

    JSONObject status() throws Exception {
        PackageGate g = gate.get();
        String reason = hidingUnsupportedReason(g != null, g != null && g.ready(), deviceAdminFeature);
        return new JSONObject()
                .put("configured", target != null)
                .put("ready", ready)
                .put("blocked", blocked)
                .put("leaseBlocked", lease.blocked(SystemClock.elapsedRealtime()))
                .put("epoch", lease.epoch())
                .put("revision", lease.revision())
                .put("enforcement", g == null ? "unavailable" : "package-gate")
                .put("packageHiding", reason == null ? "supported" : "unsupported")
                .put("packageHidingReason", reason == null ? JSONObject.NULL : reason);
    }

    private synchronized void enforce(boolean desired) {
        PackageGate g = gate.get();
        if (target == null || g == null || !g.ready()) { ready = false; blocked = true; return; }
        try {
            boolean actual = g.isHidden(target);
            if (actual != desired && !g.setHidden(target, desired)) throw new SecurityException();
            blocked = g.isHidden(target);
            ready = blocked == desired;
            if (!ready) lease.revoke();
        } catch (Exception error) {
            ready = false;
            lease.revoke();
            Log.w(TAG, "Package restriction unverified");
        }
        if (desired && awake.isHeld()) awake.release();
    }

    private final Runnable tick = new Runnable() {
        public void run() {
            if (stopped) return;
            enforce(lease.blocked(SystemClock.elapsedRealtime()));
            handler.postDelayed(this, 100);
        }
    };

    private final Runnable poll = new Runnable() {
        public void run() {
            if (stopped) return;
            if (!fetching && endpoint != null) {
                fetching = true;
                final long started = SystemClock.elapsedRealtime();
                final boolean localReady = ready, localBlocked = blocked;
                final long epoch = lease.epoch(), revision = lease.revision();
                try {
                    network.execute(() -> {
                        final JSONObject result = fetch(localReady, localBlocked, epoch, revision);
                        handler.post(() -> accept(started, result));
                    });
                } catch (java.util.concurrent.RejectedExecutionException shuttingDown) {
                    return;
                }
            }
            handler.postDelayed(this, 1000);
        }
    };

    private JSONObject fetch(boolean localReady, boolean localBlocked, long epoch, long revision) {
        HttpsURLConnection connection = null;
        try {
            connection = (HttpsURLConnection) new URL(endpoint).openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(1500);
            connection.setReadTimeout(1500);
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setRequestProperty("Authorization", "Bearer " + credential);
            connection.setRequestProperty("Content-Type", "application/json");
            JSONObject ack = new JSONObject().put("protocol", 1).put("capabilityReady", localReady)
                    .put("blocked", localBlocked).put("epoch", epoch).put("commandRevision", revision);
            byte[] bytes = new JSONObject().put("packageName", target).put("ack", ack).toString().getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream out = connection.getOutputStream()) { out.write(bytes); }
            if (connection.getResponseCode() == 200) return new JSONObject(read(connection.getInputStream()));
        } catch (Exception error) {
            // The existing lease expires locally. Never log the bearer or the response.
        } finally {
            if (connection != null) connection.disconnect();
        }
        return null;
    }

    private void accept(long started, JSONObject result) {
        fetching = false;
        if (stopped || result == null) return;
        try {
            if (result.getInt("protocol") != 1) throw new IllegalArgumentException();
            lease.accept(started, SystemClock.elapsedRealtime(), result.getLong("epoch"), result.getLong("commandRevision"),
                    result.getBoolean("blockedCommand"), result.getBoolean("allowed"), result.getLong("leaseMs"));
            if (!order.save(lease)) lease.revoke();
            if (!lease.blocked(SystemClock.elapsedRealtime())) awake.acquire(6000);
            enforce(lease.blocked(SystemClock.elapsedRealtime()));
        } catch (Exception error) {
            lease.revoke();
            enforce(true);
        }
    }

    private static String read(InputStream stream) throws IOException {
        try (InputStream in = stream; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] bytes = new byte[1024];
            int length;
            while ((length = in.read(bytes)) != -1) {
                if (out.size() + length > 8192) throw new IOException();
                out.write(bytes, 0, length);
            }
            return out.toString("UTF-8");
        }
    }
}
