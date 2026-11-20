package net.kckern.portalkeys.payload;

import org.junit.Test;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import static org.junit.Assert.*;

public class PolicyReconcilerTest {
    /** In-memory device policy state that records every write. */
    static final class FakeDevice implements PolicyReconciler.Device {
        final List<String> writes = new ArrayList<>();
        String[] lockTaskPackages = new String[0];
        int lockTaskFeatures = 16;
        boolean uninstallBlocked, statusBarAccepted = true;
        final Set<String> restrictions = new HashSet<>(Arrays.asList("no_create_windows"));
        CharSequence organization;
        final Map<String, Boolean> hidden = new HashMap<>();
        String webview = "com.android.chrome";
        final Set<String> unreadable = new HashSet<>();
        void read(String what) { if (unreadable.contains(what)) throw new SecurityException(what + " unreadable"); }

        @Override public void addPersistentHome() { writes.add("home"); }
        @Override public String[] lockTaskPackages() { read("lockTaskPackages"); return lockTaskPackages; }
        @Override public void setLockTaskPackages(String[] p) { writes.add("lockTaskPackages"); lockTaskPackages = p; }
        @Override public int lockTaskFeatures() { read("lockTaskFeatures"); return lockTaskFeatures; }
        @Override public void setLockTaskFeatures(int f) { writes.add("lockTaskFeatures"); lockTaskFeatures = f; }
        @Override public boolean disableStatusBar() { writes.add("statusBar"); return statusBarAccepted; }
        @Override public void disableKeyguard() { writes.add("keyguard"); }
        @Override public boolean uninstallBlocked() { read("uninstallBlocked"); return uninstallBlocked; }
        @Override public void blockUninstall() { writes.add("uninstall"); uninstallBlocked = true; }
        @Override public Set<String> restrictions() { read("restrictions"); return new HashSet<>(restrictions); }
        @Override public void addRestriction(String r) { writes.add("+" + r); restrictions.add(r); }
        @Override public void clearRestriction(String r) { writes.add("-" + r); restrictions.remove(r); }
        @Override public void setOrganizationName(String n) { writes.add("organization"); organization = n; }
        @Override public boolean hidden(String pkg) { read("hidden"); return Boolean.TRUE.equals(hidden.get(pkg)); }
        @Override public void setHidden(String pkg, boolean h) { writes.add((h ? "hide " : "show ") + pkg); hidden.put(pkg, h); }
        @Override public String webviewPackage() { return webview; }
    }

    @Test public void firstPassAppliesTheWholePolicy() {
        FakeDevice d = new FakeDevice();
        PolicyReconciler.reconcile(d, true, true, true);
        assertEquals(Arrays.asList("home", "lockTaskPackages", "lockTaskFeatures", "statusBar", "uninstall",
                "-no_create_windows", "keyguard", "organization", "+no_safe_boot", "+no_factory_reset",
                "+no_add_user", "+no_control_apps", "hide org.chromium.chrome",
                "hide com.facebook.alohaapps.controlcenter", "hide com.android.systemui"), d.writes);
    }

    @Test public void aSteadyPolicyIsReadNotRewritten() {
        // 2026-11-19: rewriting every policy every 5 s made Fully stall ~1.6 s per pass, past
        // the Fully guard's 1.5 s timeout, and the guard reported a breach every 20-35 s.
        FakeDevice d = new FakeDevice();
        PolicyReconciler.reconcile(d, true, true, true);
        d.writes.clear();
        for (int i = 0; i < 3; i++) assertEquals(0, PolicyReconciler.reconcile(d, true, false, true).size());
        assertTrue(d.writes.isEmpty());
    }

    @Test public void repairsOnlyWhatDrifted() {
        FakeDevice d = new FakeDevice();
        PolicyReconciler.reconcile(d, true, true, true);
        d.writes.clear();
        d.hidden.put("com.android.systemui", false);
        d.lockTaskPackages = new String[]{"de.ozerov.fully", "com.example"};
        d.restrictions.remove("no_factory_reset");
        d.restrictions.add("no_create_windows");
        List<String> expected = Arrays.asList("lockTaskPackages", "-no_create_windows", "+no_factory_reset", "hide com.android.systemui");
        assertEquals(expected, PolicyReconciler.reconcile(d, true, false, true));
        assertEquals(expected, d.writes);
    }

    @Test public void reassertsHomeWhenHomeIsWrong() {
        FakeDevice d = new FakeDevice();
        PolicyReconciler.reconcile(d, true, true, true);
        d.writes.clear();
        PolicyReconciler.reconcile(d, false, false, true);
        assertEquals(Arrays.asList("home"), d.writes);
    }

    @Test public void organizationNameIsWrittenOnceBecauseADeviceOwnerCannotReadIt() {
        // Android 9: getOrganizationName throws SecurityException outside a managed profile (2026-11-19, p7.2).
        FakeDevice d = new FakeDevice();
        PolicyReconciler.reconcile(d, true, true, true);
        assertTrue(d.writes.contains("organization"));
        d.writes.clear();
        PolicyReconciler.reconcile(d, true, false, true);
        assertFalse(d.writes.contains("organization"));
    }

    @Test public void anUnreadableSettingIsSkippedAndTheRestStillReconcile() {
        FakeDevice d = new FakeDevice();
        PolicyReconciler.reconcile(d, true, true, true);
        d.writes.clear();
        d.unreadable.add("restrictions");
        d.unreadable.add("uninstallBlocked");
        d.hidden.put("com.android.systemui", false);
        List<String> writes = PolicyReconciler.reconcile(d, true, false, true);
        assertEquals(Arrays.asList("hide com.android.systemui"), writes);
    }

    @Test public void anUnreadableSettingIsStillWrittenOnTheFirstPass() {
        FakeDevice d = new FakeDevice();
        d.unreadable.add("restrictions");
        d.unreadable.add("hidden");
        PolicyReconciler.reconcile(d, true, true, true);
        assertTrue(d.writes.contains("+no_safe_boot"));
        assertTrue(d.writes.contains("-no_create_windows"));
        assertTrue(d.writes.contains("hide com.android.systemui"));
    }

    @Test public void keepsTheActiveWebViewProviderVisible() {
        FakeDevice d = new FakeDevice();
        d.webview = "org.chromium.chrome";
        PolicyReconciler.reconcile(d, true, true, true);
        assertFalse(d.writes.contains("hide org.chromium.chrome"));
        assertTrue(d.writes.contains("hide com.android.chrome"));
    }

    @Test public void showsShellUiWhenConfigured() {
        FakeDevice d = new FakeDevice();
        PolicyReconciler.reconcile(d, true, true, true);
        d.writes.clear();
        PolicyReconciler.reconcile(d, true, false, false);
        assertEquals(Arrays.asList("show com.facebook.alohaapps.controlcenter", "show com.android.systemui"), d.writes);
    }

    @Test(expected = IllegalStateException.class)
    public void aRejectedStatusBarPolicyFails() {
        FakeDevice d = new FakeDevice();
        d.statusBarAccepted = false;
        PolicyReconciler.reconcile(d, true, true, true);
    }
}
