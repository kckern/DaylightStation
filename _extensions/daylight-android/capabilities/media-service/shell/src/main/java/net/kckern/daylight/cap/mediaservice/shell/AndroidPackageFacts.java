package net.kckern.daylight.cap.mediaservice.shell;

import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;

import java.security.MessageDigest;

/**
 * PackageFacts from the package manager. A package that binds this app's service is
 * visible to it on Android 11 and later without a queries entry, so the caller's own
 * package can be read. Whatever cannot be read answers null or false, and the policy
 * then refuses.
 */
final class AndroidPackageFacts implements PackageFacts {
    private final PackageManager pm;

    AndroidPackageFacts(PackageManager pm) { this.pm = pm; }

    @Override public String[] packagesForUid(int uid) {
        try {
            return pm.getPackagesForUid(uid);
        } catch (RuntimeException e) {
            return null;
        }
    }

    @Override public String signingSha256(String packageName) {
        // Below Android 9 the only API is one that can be fooled by an APK with several
        // signatures; a third-party controller cannot be pinned there.
        if (Build.VERSION.SDK_INT < 28) return null;
        try {
            PackageInfo info = pm.getPackageInfo(packageName, PackageManager.GET_SIGNING_CERTIFICATES);
            if (info == null || info.signingInfo == null || info.signingInfo.hasMultipleSigners()) return null;
            Signature[] signers = info.signingInfo.getApkContentsSigners();
            if (signers == null || signers.length != 1) return null;
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(signers[0].toByteArray());
            StringBuilder hex = new StringBuilder();
            for (byte b : digest) hex.append(String.format("%02x", b));
            return hex.toString();
        } catch (Exception notReadable) {
            return null;
        }
    }

    @Override public boolean platformSigned(String packageName) {
        try {
            return pm.checkSignatures("android", packageName) == PackageManager.SIGNATURE_MATCH;
        } catch (RuntimeException e) {
            return false;
        }
    }
}
