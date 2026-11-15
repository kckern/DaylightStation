package net.kckern.supervisionguard;
import android.app.admin.DeviceAdminReceiver;
import android.content.Context;
import android.content.Intent;
public final class GuardAdmin extends DeviceAdminReceiver {
 @Override public void onEnabled(Context context,Intent intent){context.startForegroundService(new Intent(context,GuardService.class));}
}
