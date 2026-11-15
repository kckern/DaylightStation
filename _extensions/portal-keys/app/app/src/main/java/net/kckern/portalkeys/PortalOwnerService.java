package net.kckern.portalkeys;

/** Android maintains this binding for the device-owner app, independently of its UI. */
public final class PortalOwnerService extends android.app.admin.DeviceAdminService {
    @Override public void onCreate() {
        super.onCreate();
        startForegroundService(new android.content.Intent(this, PortalBridgeService.class));
    }
}
