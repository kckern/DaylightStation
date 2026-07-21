package net.kckern.portalkeys;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.util.Log;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * ADB-free APK upgrades, mirroring piano-bridge's self-update.
 *
 * Why this exists: ADB-over-WiFi does NOT survive a reboot on this panel, and it cannot be
 * made to — `adb root` is refused on a production build and `setprop persist.adb.tcp.port`
 * needs root. On 2026-07-21 a one-line manifest fix (cleartext HTTP) sat un-deployable for
 * an entire debugging round because the only install path was a USB cable in another room.
 *
 * `REQUEST_INSTALL_PACKAGES` is granted once over USB via `appops set ... allow` and
 * survives reboots, so after that first cable this path is always available.
 *
 * CAVEAT: this device has a Google account and Fully is not device-owner, so Android shows
 * a ONE-TAP CONFIRM on the panel for each install. There is no fully silent path. It still
 * beats needing a cable.
 */
public class SelfUpdater {

    private static final String TAG = PortalKeysService.TAG;

    private final Context ctx;
    private final EventLog eventLog;

    public SelfUpdater(Context ctx, EventLog eventLog) {
        this.ctx = ctx;
        this.eventLog = eventLog;
    }

    /** Downloads the APK at {@code url} and hands it to PackageInstaller. Blocking. */
    public String install(String url) {
        eventLog.add("self-update start " + url);
        PackageInstaller installer = ctx.getPackageManager().getPackageInstaller();
        HttpURLConnection conn = null;
        PackageInstaller.Session session = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(60000);
            if (conn.getResponseCode() != 200) {
                String err = "download http " + conn.getResponseCode();
                eventLog.add("self-update failed " + err);
                return err;
            }

            PackageInstaller.SessionParams params =
                    new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            int sessionId = installer.createSession(params);
            session = installer.openSession(sessionId);

            long written = 0;
            try (InputStream in = conn.getInputStream();
                 OutputStream out = session.openWrite("portalkeys.apk", 0, -1)) {
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    written += n;
                }
                session.fsync(out);
            }

            Intent intent = new Intent(ctx, PortalKeysService.class);
            PendingIntent pending = PendingIntent.getBroadcast(
                    ctx, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT);
            session.commit(pending.getIntentSender());

            eventLog.add("self-update committed bytes=" + written);
            Log.i(TAG, "self-update committed, " + written + " bytes — tap Install on the panel");
            return "committed " + written + " bytes — tap Install on the panel";
        } catch (Exception e) {
            String err = e.getClass().getSimpleName() + ": " + e.getMessage();
            eventLog.add("self-update failed " + err);
            Log.w(TAG, "self-update failed: " + err);
            if (session != null) session.abandon();
            return err;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
