package net.kckern.audiobridge;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

public class BootReceiver extends BroadcastReceiver {

    private static final String TAG = "AudioBridge";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            Log.i(TAG, "Boot completed — starting AudioBridgeService");
            Intent serviceIntent = new Intent(context, AudioBridgeService.class);
            context.startForegroundService(serviceIntent);
        }
    }
}
