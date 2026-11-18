package net.kckern.daylight.cap.lockdown;

import android.content.ComponentName;
import android.content.Context;
import android.content.pm.PackageManager;

/**
 * The activity-alias that carries the HOME filter. The device manifest declares it
 * disabled, so installing this app adds no home candidate. It is switched on the device,
 * by POST /lockdown/home, at the moment the home app is to change.
 */
interface HomeAlias {
    /** The alias's class name in the generated device manifest (DeviceManifestSource.HOME_ALIAS). */
    String NAME = "net.kckern.daylight.cap.lockdown.shell.KioskHome";

    String ENABLED = "enabled";
    String DISABLED = "disabled";
    String UNKNOWN = "unknown";

    /** enabled, disabled, or unknown when the package manager cannot be asked. */
    String state();

    /** Null when the alias is now in the wanted state, otherwise why it is not. */
    String set(boolean enabled);

    /** The real one. DONT_KILL_APP: the kiosk keeps running through the change. */
    final class Android implements HomeAlias {
        private final Context context;

        Android(Context context) { this.context = context; }

        private ComponentName component() { return new ComponentName(context.getPackageName(), NAME); }

        @Override public String state() {
            try {
                PackageManager pm = context.getPackageManager();
                if (pm == null) return UNKNOWN;
                // DEFAULT is what the manifest says, and the manifest says disabled.
                return pm.getComponentEnabledSetting(component()) == PackageManager.COMPONENT_ENABLED_STATE_ENABLED
                        ? ENABLED : DISABLED;
            } catch (Throwable t) {
                return UNKNOWN;
            }
        }

        @Override public String set(boolean enabled) {
            try {
                PackageManager pm = context.getPackageManager();
                if (pm == null) return "no package manager";
                pm.setComponentEnabledSetting(component(),
                        enabled ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED : PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                        PackageManager.DONT_KILL_APP);
                String now = state();
                return (enabled ? ENABLED : DISABLED).equals(now) ? null : "the alias is still " + now;
            } catch (Throwable t) {
                return t.getClass().getSimpleName() + ": " + t.getMessage();
            }
        }
    }
}
