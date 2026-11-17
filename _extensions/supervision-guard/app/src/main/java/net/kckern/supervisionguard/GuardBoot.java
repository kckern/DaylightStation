package net.kckern.supervisionguard;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
public final class GuardBoot extends BroadcastReceiver {
 @Override public void onReceive(Context context,Intent intent){String action=intent.getAction();if(Intent.ACTION_LOCKED_BOOT_COMPLETED.equals(action)||Intent.ACTION_BOOT_COMPLETED.equals(action)||Intent.ACTION_MY_PACKAGE_REPLACED.equals(action))context.startForegroundService(new Intent(context,GuardService.class));}
}
