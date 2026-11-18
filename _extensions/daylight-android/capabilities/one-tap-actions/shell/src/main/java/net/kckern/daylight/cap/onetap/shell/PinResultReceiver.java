package net.kckern.daylight.cap.onetap.shell;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

import net.kckern.daylight.api.PayloadPort;

/**
 * Receives the launcher's confirmation that the owner pinned a media shortcut. Not
 * exported: it is reached only through the immutable PendingIntent the payload handed
 * to requestPinShortcut, which the system sends once the shortcut is pinned. It passes
 * the request's single-use token to the payload, which records the pin; a token the
 * payload did not mint for a pending request records nothing.
 *
 * If the process was restarted between the dialog and the confirmation, the payload
 * no longer holds the token and nothing is recorded.
 */
public final class PinResultReceiver extends BroadcastReceiver {
    private static final String TAG = "Daylight-Action";
    private static final long WAIT_MS = 3000;

    @Override
    public void onReceive(Context context, Intent intent) {
        final String request = PinConfirmation.request(intent == null ? null : intent.getStringExtra(PinConfirmation.EXTRA_TOKEN));
        if (request == null) return;
        final PendingResult pending = goAsync();
        Thread t = new Thread(() -> {
            try {
                PayloadPort.named(PinConfirmation.PORT).call(request, WAIT_MS);
            } catch (Throwable notNow) {
                Log.w(TAG, "a pin confirmation could not be handed over: " + notNow.getClass().getSimpleName());
            } finally {
                pending.finish();
            }
        }, "Daylight-pin-confirm");
        t.setDaemon(true);
        t.start();
    }
}
