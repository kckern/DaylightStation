package net.kckern.daylight.core;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.security.MessageDigest;

/**
 * POST /update from download to commit, in the order that matters: fetch, check the
 * hash, check what the APK is, and only then hand it to the installer. Android is
 * behind three small interfaces so the order is tested on the JVM.
 */
final class UpdateFlow {
    /** A refusal the caller caused or can read: reported as the route's error text. */
    static final class Refused extends Exception {
        Refused(String why) { super(why); }
    }

    static final class Result {
        final long bytes;
        /** The confirmation dialog will be tapped for the user. */
        final boolean confirming;
        Result(long bytes, boolean confirming) { this.bytes = bytes; this.confirming = confirming; }
    }

    /** What an APK file says it is. */
    static final class ApkInfo {
        final String packageName;
        final long versionCode;
        ApkInfo(String packageName, long versionCode) { this.packageName = packageName; this.versionCode = versionCode; }
    }

    interface Fetcher { long fetch(String url, File dest) throws Exception; }

    interface Device {
        /** Null when the file is not a readable APK. */
        ApkInfo inspect(File apk);
        String ownPackage();
        long installedVersionCode();
        /** Stream the APK into an install session and commit it. Returns the session id. */
        int commit(File apk) throws Exception;
        boolean autoConfirmSetting();
        /** Start tapping the confirmation for this session. */
        void confirm(int sessionId);
    }

    private UpdateFlow() { }

    /**
     * @param sha256 what the caller says the APK hashes to, already checked to be 64 hex characters, or null
     * The staged file is deleted on every path: once committed its bytes are in the
     * install session, and a refused download has no reason to stay on disk.
     */
    static Result run(String url, String sha256, File staged, Fetcher fetcher, Device device) throws Exception {
        try {
            long bytes = fetcher.fetch(url, staged);
            String refusal = UpdatePolicy.shaRefusal(sha256, sha256 == null ? null : sha256Of(staged));
            if (refusal == null) {
                ApkInfo apk = device.inspect(staged);
                refusal = UpdatePolicy.apkRefusal(apk == null ? null : apk.packageName, apk == null ? 0 : apk.versionCode,
                        device.ownPackage(), device.installedVersionCode());
            }
            if (refusal != null) throw new Refused(refusal);
            int sessionId = device.commit(staged);
            // After the commit, so the confirmation knows which session it is waiting on.
            boolean confirming = UpdatePolicy.mayAutoConfirm(device.autoConfirmSetting(), sha256 != null);
            if (confirming) device.confirm(sessionId);
            return new Result(bytes, confirming);
        } finally {
            staged.delete();
        }
    }

    static String sha256Of(File f) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(f)) {
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
        }
        StringBuilder hex = new StringBuilder();
        for (byte b : md.digest()) hex.append(String.format("%02x", b));
        return hex.toString();
    }
}
