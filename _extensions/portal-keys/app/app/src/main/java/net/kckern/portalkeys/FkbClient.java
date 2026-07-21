package net.kckern.portalkeys;

import android.net.Uri;
import android.util.Log;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Talks to FullyKiosk's REST API on this same device.
 *
 * Why go through FKB rather than a PowerManager wakelock: FKB owns the display state
 * machine on this panel. Blanking with FKB screenOff and restoring with a wakelock
 * leaves two owners fighting over the backlight. Symmetric screenOff/screenOn keeps
 * FKB the single authority.
 *
 * GOTCHA carried over from the piano tablet: the FKB REST API silently returns its
 * HTML LOGIN PAGE instead of executing when `type=json` is omitted. A command that
 * appears to do nothing has usually just been served the login page. So every request
 * here sets type=json, and we treat an HTML-looking body as a failure rather than
 * reporting a false success.
 */
public class FkbClient {

    private static final String TAG = PortalKeysService.TAG;
    private static final int TIMEOUT_MS = 4000;

    private final Config config;

    /** Reason for the most recent failure, exposed via /status for ADB-free diagnosis. */
    private volatile String lastError = null;

    public String lastError() { return lastError; }

    public FkbClient(Config config) {
        this.config = config;
    }

    public boolean screenOn() {
        return command("screenOn");
    }

    public boolean screenOff() {
        return command("screenOff");
    }

    /** @return true only when FKB actually executed the command. */
    public boolean command(String cmd) {
        String password = config.fkbPassword();
        if (password.isEmpty()) {
            lastError = "no fkbPassword set (run: pkctl fkbpw)";
            Log.w(TAG, "fkb-command-skipped: " + lastError);
            return false;
        }

        HttpURLConnection conn = null;
        try {
            String url = new Uri.Builder()
                    .scheme("http")
                    .encodedAuthority(config.fkbHost())
                    .path("/")
                    .appendQueryParameter("cmd", cmd)
                    // MANDATORY — without this FKB serves the login page and no-ops.
                    .appendQueryParameter("type", "json")
                    .appendQueryParameter("password", password)
                    .build()
                    .toString();

            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(TIMEOUT_MS);
            conn.setReadTimeout(TIMEOUT_MS);
            conn.setRequestMethod("GET");

            int code = conn.getResponseCode();
            String body = readBody(conn);

            // A login page means the password was wrong or type=json was dropped.
            boolean looksLikeLogin = body.contains("<html") || body.contains("Login");
            boolean ok = code == 200 && !looksLikeLogin;

            if (!ok) {
                lastError = "http " + code + (looksLikeLogin ? " (login page — bad password?)" : "");
                Log.w(TAG, "fkb-command-failed: cmd=" + cmd + " " + lastError);
            } else {
                lastError = null;
                Log.i(TAG, "fkb-command-ok: " + cmd);
            }
            return ok;
        } catch (Exception e) {
            // Surface the reason through the control plane, not just logcat. ADB-over-WiFi
            // does not survive a reboot on this panel, so logcat is routinely unreachable
            // and "ok=false" with no reason is a dead end — that cost a whole debugging
            // round on the cleartext-blocked failure.
            lastError = e.getClass().getSimpleName() + ": " + e.getMessage();
            Log.w(TAG, "fkb-command-error: cmd=" + cmd + " err=" + lastError);
            return false;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private String readBody(HttpURLConnection conn) {
        try (InputStream in = conn.getInputStream()) {
            byte[] buf = new byte[2048];
            int n = in.read(buf);
            return n > 0 ? new String(buf, 0, n, "UTF-8") : "";
        } catch (Exception e) {
            return "";
        }
    }
}
