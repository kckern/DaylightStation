package net.kckern.daylight.cap.lockdown;

import static org.junit.Assert.*;

import org.junit.Test;

public class HomeStateTest {
    private static final String PKG = "net.kckern.daylight.portal";
    private static final String KIOSK = "net.kckern.daylight.cap.webviewhost.shell.KioskActivity";
    private static final String ALIAS = "net.kckern.daylight.cap.lockdown.shell.KioskHome";
    private static final String OURS = PKG + "/" + KIOSK;

    @Test public void acceptsOnlyOurKioskActivityOrItsAlias() {
        assertTrue(HomeState.isKioskHome(OURS, PKG, KIOSK, ALIAS));
        assertTrue(HomeState.isKioskHome(PKG + "/" + ALIAS, PKG, KIOSK, ALIAS));
        assertFalse(HomeState.isKioskHome(PKG + "/net.kckern.daylight.shell.MainActivity", PKG, KIOSK, ALIAS));
        assertFalse(HomeState.isKioskHome("de.ozerov.fully/.LauncherReplacement", PKG, KIOSK, ALIAS));
        assertFalse(HomeState.isKioskHome("android/com.android.internal.app.ResolverActivity", PKG, KIOSK, ALIAS));
        assertFalse(HomeState.isKioskHome(null, PKG, KIOSK, ALIAS));
        assertFalse(HomeState.isKioskHome("a/b/c", PKG, KIOSK, ALIAS));
    }

    @Test public void expandsAShortActivityName() {
        assertTrue(HomeState.isKioskHome("com.x/.Home", "com.x", "com.x.Home"));
    }

    @Test public void recordsLossAndRecoveryOncePerTransition() {
        HomeState s = new HomeState();
        assertNull(s.observe(OURS, PKG, KIOSK));
        assertEquals("home-lost", s.observe("com.other.launcher/.Home", PKG, KIOSK));
        assertNull(s.observe("com.other.launcher/.Home", PKG, KIOSK));
        assertEquals("home-restored", s.observe(OURS, PKG, KIOSK));
        assertEquals(1, s.incidents);
        assertEquals("home-lost", s.observe(null, PKG, KIOSK));
        assertEquals(2, s.incidents);
    }

    @Test public void notBeingHomeAtStartupIsReportedOnce() {
        HomeState s = new HomeState();
        assertEquals("home-lost", s.observe("de.ozerov.fully/.LauncherReplacement", PKG, KIOSK));
        assertFalse(s.homeIsKiosk);
        assertNull(s.observe("de.ozerov.fully/.LauncherReplacement", PKG, KIOSK));
    }
}
