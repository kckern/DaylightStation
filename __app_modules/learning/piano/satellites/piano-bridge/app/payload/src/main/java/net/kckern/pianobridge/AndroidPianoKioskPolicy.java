package net.kckern.pianobridge;

import android.app.ActivityManager;
import android.app.ActivityOptions;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.SystemClock;
import android.provider.Settings;
import java.util.Arrays;
import java.util.function.BooleanSupplier;

/** Android boundary. No hidden/reflection API or setter-as-readback substitute. */
final class AndroidPianoKioskPolicy implements PianoKioskPolicy.Port {
    private static final String FULLY="de.ozerov.fully";
    private final Context context;
    private final DevicePolicyManager dpm;
    private final ComponentName admin;
    private final BridgeCore core;
    AndroidPianoKioskPolicy(BridgeCore core) {
        this.core=core; context=core.getContext();
        dpm=context.getSystemService(DevicePolicyManager.class);
        admin=new ComponentName(context.getPackageName(), "net.kckern.pianobridge.PianoAdminReceiver");
    }
    static PianoKioskPolicy create(BridgeCore core) {
        Context c=core.getContext();
        SharedPreferences prefs=c.getSharedPreferences("kiosk-maintenance", Context.MODE_PRIVATE);
        PianoKioskPolicy.Store store=new PianoKioskPolicy.Store() {
            private int boot() { return Settings.Global.getInt(c.getContentResolver(), Settings.Global.BOOT_COUNT, -1); }
            public long read() {
                int boot=boot();
                if (boot<0 || prefs.getInt("boot", -2)!=boot) return 0;
                long remaining=prefs.getLong("elapsedUntil", 0)-SystemClock.elapsedRealtime();
                return remaining<=0 ? 0 : System.currentTimeMillis()+Math.min(remaining, PianoKioskPolicy.MAX_MAINTENANCE_MS);
            }
            public void write(long until) {
                long remaining=Math.max(0, until-System.currentTimeMillis());
                if (!prefs.edit().putInt("boot", boot()).putLong("elapsedUntil", remaining==0 ? 0 : SystemClock.elapsedRealtime()+remaining).commit())
                    throw new IllegalStateException("maintenance persistence failed");
            }
        };
        return new PianoKioskPolicy(new AndroidPianoKioskPolicy(core), store, core::nativeRunAllowed,
                System::currentTimeMillis, SystemClock::elapsedRealtime);
    }
    private Intent home() { return new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME); }
    public PianoKioskPolicy.Readback read() {
        boolean owner=dpm!=null && dpm.isDeviceOwnerApp(context.getPackageName());
        ResolveInfo resolved=context.getPackageManager().resolveActivity(home(), PackageManager.MATCH_DEFAULT_ONLY);
        boolean home=resolved!=null && resolved.activityInfo!=null && FULLY.equals(resolved.activityInfo.packageName);
        ActivityManager am=context.getSystemService(ActivityManager.class);
        Boolean locked=am==null ? null : am.getLockTaskModeState()==ActivityManager.LOCK_TASK_MODE_LOCKED;
        Boolean packages=owner ? Arrays.equals(new String[]{FULLY}, dpm.getLockTaskPackages(admin)) : null;
        Boolean features=owner ? dpm.getLockTaskFeatures(admin)==DevicePolicyManager.LOCK_TASK_FEATURE_NONE : null;
        // Public Android 10 has setters but NO getter for either of these properties.
        return new PianoKioskPolicy.Readback(owner, home, locked, null, packages, features, null);
    }
    public void apply() {
        if (!core.nativeRunAllowed()) throw new IllegalStateException("native safety refused");
        Intent launch=context.getPackageManager().getLaunchIntentForPackage(FULLY);
        if (launch==null || launch.getComponent()==null) throw new IllegalStateException("Fully unavailable");
        IntentFilter filter=new IntentFilter(Intent.ACTION_MAIN);
        filter.addCategory(Intent.CATEGORY_HOME); filter.addCategory(Intent.CATEGORY_DEFAULT);
        // Resolve Fully's actual HOME activity; its launcher entry need not be HOME-capable.
        ComponentName homeComponent=null;
        for (ResolveInfo r:context.getPackageManager().queryIntentActivities(home().setPackage(FULLY), 0)) {
            if (r.activityInfo!=null) { homeComponent=new ComponentName(r.activityInfo.packageName,r.activityInfo.name); break; }
        }
        if (homeComponent==null) throw new IllegalStateException("Fully HOME activity unavailable");
        dpm.addPersistentPreferredActivity(admin, filter, homeComponent);
        dpm.setLockTaskPackages(admin, new String[]{FULLY});
        dpm.setLockTaskFeatures(admin, DevicePolicyManager.LOCK_TASK_FEATURE_NONE);
        dpm.setStatusBarDisabled(admin, true);
        if (!core.nativeRunAllowed()) throw new IllegalStateException("native safety revoked");
        if (context.getSystemService(ActivityManager.class).getLockTaskModeState()!=ActivityManager.LOCK_TASK_MODE_LOCKED) {
            ActivityOptions options=ActivityOptions.makeBasic(); options.setLockTaskEnabled(true);
            context.startActivity(launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), options.toBundle());
        }
    }
    public void release() {
        releaseWithAuthority(core::nativeRunAllowed,
                () -> dpm.setLockTaskPackages(admin, new String[0]),
                () -> dpm.setStatusBarDisabled(admin, false));
    }
    // The actual Android release path, with setters injected for JVM interleaving tests.
    static void releaseWithAuthority(BooleanSupplier allowed, Runnable clearPackages, Runnable enableStatusBar) {
        // Empty allowlist exits this owner's lock task without broadly whitelisting Settings.
        if (!allowed.getAsBoolean()) throw new IllegalStateException("native safety revoked");
        clearPackages.run();
        if (!allowed.getAsBoolean()) throw new IllegalStateException("native safety revoked");
        enableStatusBar.run();
    }
}
