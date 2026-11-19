package net.kckern.portalkeys.payload;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Device-owner kiosk policy as reconcile-by-readback. The first pass writes the whole policy;
 * later passes read each setting and write only what has drifted.
 *
 * Rewriting the whole policy every 5 s (p7) cost Fully a ~1.6 s main-thread stall per pass
 * (activity pause timeout, skipped frames, REST server blocked). That crossed the Fully guard's
 * 1.5 s read timeout and reported a breach then a recovery every 20-35 s (2026-11-19).
 * Status bar and keyguard have no public getter on API 28; DevicePolicyManagerService persists
 * them and only this device owner can change them, so they are written on the first pass only.
 */
final class PolicyReconciler {
    static final String FULLY = "de.ozerov.fully";
    static final String ORGANIZATION = "School Portal";
    static final String CREATE_WINDOWS = "no_create_windows";
    static final String[] RESTRICTIONS = {"no_safe_boot", "no_factory_reset", "no_add_user", "no_control_apps"};
    static final String[] BROWSERS = {"org.chromium.chrome", "com.android.chrome"};
    static final String[] SHELL_UI = {"com.facebook.alohaapps.controlcenter", "com.android.systemui"};

    interface Device {
        void addPersistentHome();
        String[] lockTaskPackages();
        void setLockTaskPackages(String[] packages);
        int lockTaskFeatures();
        void setLockTaskFeatures(int features);
        boolean disableStatusBar();
        void disableKeyguard();
        boolean uninstallBlocked();
        void blockUninstall();
        Set<String> restrictions();
        void addRestriction(String restriction);
        void clearRestriction(String restriction);
        CharSequence organizationName();
        void setOrganizationName(String name);
        boolean hidden(String pkg);
        void setHidden(String pkg, boolean hidden);
        String webviewPackage();
    }

    /** Returns the writes made, in order, using the same labels as the tests. */
    static List<String> reconcile(Device d, boolean homeCorrect, boolean firstPass, boolean hideShellUi) {
        List<String> writes = new ArrayList<>();
        if (firstPass || !homeCorrect) { d.addPersistentHome(); writes.add("home"); }
        String[] packages = {FULLY};
        if (firstPass || !new HashSet<>(Arrays.asList(nullSafe(d.lockTaskPackages()))).equals(new HashSet<>(Arrays.asList(packages)))) {
            d.setLockTaskPackages(packages); writes.add("lockTaskPackages");
        }
        if (firstPass || d.lockTaskFeatures() != 0) { d.setLockTaskFeatures(0); writes.add("lockTaskFeatures"); }
        if (firstPass) {
            writes.add("statusBar");
            if (!d.disableStatusBar()) throw new IllegalStateException("status-bar-policy-rejected");
        }
        if (firstPass || !d.uninstallBlocked()) { d.blockUninstall(); writes.add("uninstall"); }
        Set<String> restrictions = d.restrictions();
        if (firstPass || restrictions.contains(CREATE_WINDOWS)) { d.clearRestriction(CREATE_WINDOWS); writes.add("-" + CREATE_WINDOWS); }
        if (firstPass) { d.disableKeyguard(); writes.add("keyguard"); }
        CharSequence org = d.organizationName();
        if (firstPass || org == null || !ORGANIZATION.equals(org.toString())) { d.setOrganizationName(ORGANIZATION); writes.add("organization"); }
        for (String r : RESTRICTIONS) {
            if (firstPass || !restrictions.contains(r)) { d.addRestriction(r); writes.add("+" + r); }
        }
        // A second browser must not remain a fallback if Fully crashes.
        String webview = d.webviewPackage();
        for (String browser : BROWSERS) {
            if (browser.equals(webview)) continue;
            if (firstPass || !d.hidden(browser)) { d.setHidden(browser, true); writes.add("hide " + browser); }
        }
        for (String pkg : SHELL_UI) {
            if (firstPass || d.hidden(pkg) != hideShellUi) { d.setHidden(pkg, hideShellUi); writes.add((hideShellUi ? "hide " : "show ") + pkg); }
        }
        return writes;
    }

    private static String[] nullSafe(String[] a) { return a == null ? new String[0] : a; }
}
