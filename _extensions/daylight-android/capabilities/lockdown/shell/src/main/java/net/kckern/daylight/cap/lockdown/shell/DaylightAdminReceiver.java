package net.kckern.daylight.cap.lockdown.shell;

import android.app.admin.DeviceAdminReceiver;
import android.content.Context;
import android.os.PersistableBundle;
import android.util.Log;

import net.kckern.daylight.api.OwnerHold;

/**
 * The device-admin component. Enough for lockNow as an admin; the device-owner
 * component where the device was provisioned to this app or ownership was transferred
 * to it.
 */
public final class DaylightAdminReceiver extends DeviceAdminReceiver {
    private static final String TAG = "Daylight-Admin";

    /**
     * Device ownership has just been transferred to this app (API 28). Nothing is
     * applied because of it. The owner hold is set, so the lockdown payload, which
     * would otherwise see "device owner" on its next pass and apply owner policy by
     * itself, stays in app mode until POST /lockdown/owner/resume. The event is logged.
     */
    @Override
    public void onTransferOwnershipComplete(Context context, PersistableBundle bundle) {
        boolean held = false;
        try {
            held = OwnerHold.set(OwnerHold.payloadDir(context.getFilesDir()), "device ownership was transferred to this app");
        } catch (Throwable t) {
            Log.w(TAG, "could not set the owner hold", t);
        }
        Log.i(TAG, "device ownership transferred to this app; owner hold set=" + held + "; no policy applied");
    }
}
