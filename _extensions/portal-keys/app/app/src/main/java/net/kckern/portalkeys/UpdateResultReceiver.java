package net.kckern.portalkeys;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.util.Log;

/** Receives PackageInstaller's result and launches its required confirmation intent. */
public final class UpdateResultReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent result) {
        int status = result.getIntExtra(PackageInstaller.EXTRA_STATUS,
                PackageInstaller.STATUS_FAILURE);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirmation = result.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirmation == null) {
                Log.e(PortalKeysService.TAG, "self-update missing confirmation intent");
                return;
            }
            confirmation.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(confirmation);
            Log.i(PortalKeysService.TAG, "self-update confirmation launched");
            return;
        }
        String message = result.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
        Log.i(PortalKeysService.TAG, "self-update result status=" + status
                + (message == null ? "" : " message=" + message));
    }
}
