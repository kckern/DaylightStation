package net.kckern.daylight.cap.lockdown;

import static org.junit.Assert.*;

import net.kckern.daylight.core.kiosk.AllowRules;

import org.junit.Test;

public class RecallDecisionTest {
    private static final String KIOSK = "net.kckern.daylight.test";

    /** Locked, display on, kiosk not resumed, watcher bound with a fresh sample of the given front. */
    private static RecallDecision.Input away(String front, String activity) {
        RecallDecision.Input in = new RecallDecision.Input();
        in.locked = true;
        in.screenOn = true;
        in.kioskResumed = false;
        in.watcherBound = true;
        in.front = front;
        in.frontActivity = activity;
        in.sampleAgeMs = 500;
        in.ownPackage = KIOSK;
        in.allow = AllowRules.parse("");
        in.exemptions = new Exemptions();
        in.nowMs = 100_000;
        in.awaySinceMs = 99_000;
        in.graceMs = 0;
        return in;
    }

    private static void assertRecall(String reason, RecallDecision.Input in) {
        RecallDecision.Decision d = RecallDecision.decide(in);
        assertTrue("expected a recall, got: " + d.reason, d.recall);
        assertEquals(reason, d.reason);
    }

    private static void assertStay(String reason, RecallDecision.Input in) {
        RecallDecision.Decision d = RecallDecision.decide(in);
        assertFalse("expected to stay, got: " + d.reason, d.recall);
        assertEquals(reason, d.reason);
    }

    @Test public void anAppThatIsNotAllowedIsRecalled() {
        assertRecall("not allowed: com.android.vending", away("com.android.vending", null));
    }

    @Test public void unlockedNeverRecalls() {
        RecallDecision.Input in = away("com.android.vending", null);
        in.locked = false;
        assertStay("unlocked", in);
    }

    @Test public void aDarkDisplayNeverRecalls() {
        RecallDecision.Input in = away("com.android.vending", null);
        in.screenOn = false;
        assertStay("display off", in);
    }

    @Test public void theKiosksOwnLifecycleIsBelievedFirst() {
        RecallDecision.Input in = away("com.android.vending", null);   // a stale sample says otherwise
        in.kioskResumed = true;
        assertStay("kiosk in front", in);
    }

    @Test public void failsClosedWhenTheWatcherCannotSee() {
        RecallDecision.Input unbound = away("com.android.vending", null);
        unbound.watcherBound = false;
        assertRecall("foreground unknown", unbound);

        RecallDecision.Input stale = away(KIOSK, null);
        stale.sampleAgeMs = RecallDecision.FRESH_MS + 1;
        assertRecall("foreground unknown", stale);

        RecallDecision.Input never = away(null, null);
        assertRecall("foreground unknown", never);
    }

    @Test public void ourOwnPackageInFrontIsNotAnEscape() {
        assertStay("own package", away(KIOSK, null));
    }

    @Test public void anAllowlistedPackageStays() {
        RecallDecision.Input in = away("com.retroarch.aarch64", null);
        in.allow = AllowRules.parse("com.retroarch.*");
        assertStay("allowed", in);
    }

    @Test public void aSingleActivityRuleAllowsOnlyThatActivity() {
        RecallDecision.Input in = away("com.android.settings", "com.android.settings.bluetooth.BluetoothPairingDialog");
        in.allow = AllowRules.parse("com.android.settings/.bluetooth.BluetoothPairingDialog");
        assertStay("allowed", in);
        in.frontActivity = "com.android.settings.Settings";
        assertRecall("not allowed: com.android.settings", in);
        in.frontActivity = null;
        assertRecall("not allowed: com.android.settings", in);
    }

    @Test public void aLiveExemptionStays() {
        RecallDecision.Input in = away("com.a.b", null);
        in.exemptions.allowWhileInFront("com.a.b", in.nowMs);
        assertStay("allowed", in);
    }

    @Test public void graceCountsFromFirstLeavingTheKiosk() {
        RecallDecision.Input in = away("com.android.vending", null);
        in.graceMs = 5_000;
        in.awaySinceMs = in.nowMs - 4_999;
        assertStay("grace", in);
        in.awaySinceMs = in.nowMs - 5_000;
        assertRecall("not allowed: com.android.vending", in);
    }

    @Test public void theAwayClockStartsOnceAndResetsOnReturn() {
        assertEquals(0, RecallDecision.awaySince(0, true, 1_000));
        assertEquals(1_000, RecallDecision.awaySince(0, false, 1_000));
        assertEquals("hopping between apps does not restart it", 1_000, RecallDecision.awaySince(1_000, false, 9_000));
        assertEquals(0, RecallDecision.awaySince(1_000, true, 9_500));
    }

    @Test public void repeatedRecallsAreNotedOnceThenEveryThirtieth() {
        assertTrue(RecallDecision.shouldNote(1));
        assertFalse(RecallDecision.shouldNote(2));
        assertFalse(RecallDecision.shouldNote(29));
        assertTrue(RecallDecision.shouldNote(30));
        assertTrue(RecallDecision.shouldNote(60));
    }

    // ── packages a lease has closed, and the system pairing dialog ───────────

    @Test public void aBlockedPackageIsRecalledEvenWhenItIsAllowlistedOrExempt() {
        RecallDecision.Input in = away("com.example.game", null);
        in.allow = AllowRules.parse("com.example.game");
        in.exemptions.allowWhileInFront("com.example.game", in.nowMs);
        in.graceMs = 60_000;
        in.blocked = java.util.Collections.singleton("com.example.game");
        assertRecall("blocked: com.example.game", in);
        in.blocked = java.util.Collections.singleton("com.example.other");
        assertStay("allowed", in);
    }

    @Test public void thePairingDialogExemptionCoversSettingsOnlyWhileItIsGranted() {
        RecallDecision.Input in = away("com.android.settings", null);
        assertRecall("not allowed: com.android.settings", in);
        in.pairingDialogAllowed = true;
        assertStay("pairing dialog", in);
        in.front = "com.android.vending";
        assertRecall("not allowed: com.android.vending", in);
    }

    @Test public void aDisplayWhoseStateCannotBeReadCountsAsOn() {
        assertTrue(RecallDecision.screenOn(null));
        assertTrue(RecallDecision.screenOn(RecallDecision.DISPLAY_ON));
        assertFalse(RecallDecision.screenOn(1));     // Display.STATE_OFF
        assertFalse(RecallDecision.screenOn(3));     // Display.STATE_DOZE
    }
}
