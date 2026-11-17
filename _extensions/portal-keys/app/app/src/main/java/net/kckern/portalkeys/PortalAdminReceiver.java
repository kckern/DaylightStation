package net.kckern.portalkeys;

import android.content.Context;
import android.os.PersistableBundle;

/** Device-policy authority for keeping Fully as Home and the only allowed task. */
public final class PortalAdminReceiver extends android.app.admin.DeviceAdminReceiver {
    /**
     * Called when another owner hands device ownership TO this app.
     *
     * Nothing is re-applied here. The payload's KioskPolicy would otherwise start
     * enforcing on its next one-second tick the moment this app is owner again, so
     * the same hold the outgoing transfer sets is set here (KioskPolicy.PREFS /
     * KioskPolicy.HOLD in the payload). Policy starts again only on an explicit
     * POST /owner/resume-policy. Beyond that hold, this only logs.
     */
    @Override public void onTransferOwnershipComplete(Context context, PersistableBundle bundle) {
        ShellLog.install(context.getApplicationContext());
        boolean held = context.getSharedPreferences("kiosk-policy", Context.MODE_PRIVATE)
                .edit().putBoolean("ownerTransferHold", true).commit();
        ShellLog.note("OWNER", "ownership transferred to this app; no policy re-applied, enforcement held="
                + held + " bundleKeys=" + (bundle == null ? 0 : bundle.size()));
    }
}
