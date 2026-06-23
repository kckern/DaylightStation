package net.kckern.pianobridge;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * BootReceiver — relaunch the bridge service after device boot, mirroring
 * audio-bridge. Uses startService() (regular started service), NOT
 * startForegroundService(), matching PianoBridgeService's lifecycle.
 */
public class BootReceiver extends BroadcastReceiver {

    private static final String TAG = "PianoBridge";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            Log.i(TAG, "Boot completed — starting PianoBridgeService");
            Intent serviceIntent = new Intent(context, PianoBridgeService.class);
            context.startService(serviceIntent);
        }
    }
}
