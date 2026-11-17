package net.kckern.daylight.core;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Updater — installs an APK of ourselves via PackageInstaller so the bridge can be
 * upgraded over the LAN control plane (POST /update), never ADB again.
 *
 * On this Android-10 tablet the app is NOT a device owner (a Google account is
 * present, which blocks `dpm set-device-owner`), so the commit returns
 * {@code STATUS_PENDING_USER_ACTION} and the system shows a one-tap confirm — see
 * InstallReceiver (shell-side), which launches that dialog. There is no silent path here.
 *
 * Requires the REQUEST_INSTALL_PACKAGES appop (pre-granted once over USB; it, like
 * the other grants, survives same-signature updates). The new APK must have a
 * versionCode >= the installed one and be signed with the same key (debug keystore).
 */
public final class Updater {

    private static final String TAG = "PianoBridge-Update";
    static final String INSTALL_ACTION = "net.kckern.daylight.INSTALL_RESULT";

    private Updater() {}

    /** Stream a staged APK file into a PackageInstaller session and commit it. Returns the session id. */
    public static int install(Context ctx, File apk) throws Exception {
        if (apk == null || !apk.exists() || apk.length() == 0) {
            throw new IllegalStateException("staged apk missing/empty");
        }
        PackageInstaller pi = ctx.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params =
                new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        // This session only ever installs this app. Recorded on the session so the
        // auto-confirm rule can check that the pending session targets this package.
        params.setAppPackageName(ctx.getPackageName());
        int sessionId = pi.createSession(params);
        Diag.log(TAG, "install session " + sessionId + " apk=" + apk.getName() + " bytes=" + apk.length());
        PackageInstaller.Session session = pi.openSession(sessionId);
        try (InputStream in = new FileInputStream(apk);
             OutputStream out = session.openWrite("daylight.apk", 0, apk.length())) {
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            session.fsync(out);
        }
        // EXPLICIT component: InstallReceiver has no <intent-filter>, so an action-only
        // (setPackage) broadcast would never match it and STATUS_PENDING_USER_ACTION
        // would be dropped → the confirm dialog would never launch. Target the class.
        Intent intent = new Intent().setClassName(ctx, "net.kckern.daylight.shell.InstallReceiver").setAction(INSTALL_ACTION);
        // Pre-S PendingIntents are mutable by default; FLAG_UPDATE_CURRENT is enough
        // for the framework to fill in the confirm Intent extra we forward.
        // From Android 12 the flag must be stated, and this one has to stay mutable for that fill-in.
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (android.os.Build.VERSION.SDK_INT >= 31) flags |= PendingIntent.FLAG_MUTABLE;
        PendingIntent pending = PendingIntent.getBroadcast(ctx, sessionId, intent, flags);
        session.commit(pending.getIntentSender());
        session.close();
        Diag.log(TAG, "install committed session " + sessionId + " — awaiting one-tap confirm on device");
        return sessionId;
    }
}
