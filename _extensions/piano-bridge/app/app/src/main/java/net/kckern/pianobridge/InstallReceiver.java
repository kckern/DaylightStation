package net.kckern.pianobridge;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;

/**
 * InstallReceiver — handles PackageInstaller status callbacks for the self-update
 * flow (see {@link Updater}).
 *
 * On Android 10 without a device owner, {@code Session.commit()} returns
 * STATUS_PENDING_USER_ACTION carrying a confirm Intent that MUST be launched (with
 * NEW_TASK, since a receiver has no activity context) to surface the one-tap install
 * dialog. Every terminal status is written to the Diag ring buffer so the result is
 * visible over the LAN via GET /log — no ADB.
 */
public class InstallReceiver extends BroadcastReceiver {

    private static final String TAG = "PianoBridge-Update";

    @Override
    public void onReceive(Context context, Intent intent) {
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, Integer.MIN_VALUE);
        String msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirm != null) {
                confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                Diag.log(TAG, "launching install confirm dialog (tap Update on device)");
                try {
                    context.startActivity(confirm);
                } catch (Exception e) {
                    Diag.log(TAG, "failed to launch confirm dialog: " + e.getMessage());
                }
            } else {
                Diag.log(TAG, "pending user action but no confirm intent");
            }
        } else if (status == PackageInstaller.STATUS_SUCCESS) {
            Diag.log(TAG, "self-update SUCCESS");
        } else {
            Diag.log(TAG, "self-update result status=" + status + " msg=" + msg);
        }
    }
}
