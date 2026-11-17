package net.kckern.daylight.cap.lockdown;

import static org.junit.Assert.*;

import android.content.Intent;

import net.kckern.daylight.core.CoreRuntime;
import net.kckern.daylight.core.Router;
import net.kckern.daylight.core.spi.DeviceAdminAccess;
import net.kckern.daylight.core.spi.InputLock;
import net.kckern.daylight.core.spi.KioskSurface;
import net.kckern.daylight.core.spi.LockdownControl;
import net.kckern.daylight.core.spi.PackageGate;
import net.kckern.daylight.core.spi.PairingDialogExemption;
import net.kckern.daylight.core.testing.FakeContext;
import net.kckern.daylight.core.testing.FakeShell;
import net.kckern.daylight.core.testing.TestCore;

import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.util.Collections;

public class LockdownCapabilityTest {
    private static final long HOUR = 60 * 60_000L;
    @Rule public TemporaryFolder tmp = new TemporaryFolder();
    private CoreRuntime core;
    private LockdownCapability cap;

    /** A kiosk window that records what lockdown asks of it. */
    private static final class FakeSurface implements KioskSurface {
        volatile boolean resumed;
        int broughtToFront, lockTaskOn, lockTaskOff;
        Boolean immersive;
        TouchObserver touches;
        String promptTitle;
        PinCallback prompt;

        @Override public boolean attached() { return true; }
        @Override public boolean inForeground() { return resumed; }
        @Override public String currentUrl() { return "https://kiosk.example/"; }
        @Override public Intent kioskIntent() { return null; }
        @Override public boolean bringToFront() { broughtToFront++; return true; }
        @Override public boolean startActivity(Intent intent) { return true; }
        @Override public String evaluate(String js, long timeoutMs) { return "null"; }
        @Override public byte[] capturePng() { return new byte[0]; }
        @Override public void setKeepScreenOn(boolean on) { }
        @Override public void setImmersive(boolean on) { immersive = on; }
        @Override public void setLockTask(boolean on) { if (on) lockTaskOn++; else lockTaskOff++; }
        @Override public void observeTouches(TouchObserver observer) { touches = observer; }
        @Override public void promptPin(String title, PinCallback callback) { promptTitle = title; prompt = callback; }
    }

    @Before public void setUp() throws Exception {
        core = TestCore.create(tmp.newFolder());
        cap = new LockdownCapability();
        assertEquals("lockdown", cap.name());
        core.add(cap);
        core.prepare(new JSONObject());
    }

    @After public void tearDown() {
        cap.stop();
        TestCore.releaseMainThread();
    }

    private JSONObject call(String method, String path, String body) throws Exception {
        return TestCore.call(core, method, path, null, body);
    }

    /** A second runtime with an Android context and a kiosk window, started for real. */
    private FakeSurface startForReal(FakeContext ctx, File dir) throws Exception {
        cap.stop();
        core = TestCore.createWithContext(dir, ctx);
        FakeSurface surface = new FakeSurface();
        core.services().provide(KioskSurface.class, surface);
        cap = new LockdownCapability();
        core.add(cap);
        core.prepare(new JSONObject());
        cap.start();
        return surface;
    }

    // ── the plan's tests ──────────────────────────────────────────────────────

    @Test public void declaresEverySettingWithItsFallback() {
        assertEquals(Boolean.TRUE, core.settings().get("lockdown.enabled"));
        assertEquals("auto", core.settings().get("lockdown.mode"));
        assertEquals("", core.settings().get("lockdown.allowedApps"));
        assertEquals(0, core.settings().get("lockdown.recallGraceMs"));
        assertEquals(60, core.settings().get("lockdown.maxUnlockMin"));
        assertEquals(10, core.settings().get("lockdown.pinUnlockMin"));
        assertEquals("", core.settings().get("lockdown.exitPin"));
        assertEquals(Boolean.TRUE, core.settings().get("lockdown.immersive"));
        assertEquals(Boolean.TRUE, core.settings().get("lockdown.statusBarShield"));
        assertEquals(Boolean.TRUE, core.settings().get("lockdown.selfEnableAccessibility"));
        assertEquals(Boolean.FALSE, core.settings().get("lockdown.ownerRestrictions"));
        assertEquals("", core.settings().get("lockdown.ownerHidePackages"));
        assertEquals(Boolean.FALSE, core.settings().get("lockdown.dismissControlCenter"));
    }

    @Test public void registersItsRoutesAndServices() {
        for (String route : new String[] { "GET /lockdown", "POST /lockdown/lock", "POST /lockdown/unlock", "POST /lockdown/input" }) {
            assertTrue("missing " + route, core.router().routes().contains(route));
        }
        assertNotNull(core.services().find(LockdownControl.class));
        assertNotNull(core.services().find(DeviceAdminAccess.class));
        assertNotNull(core.services().find(InputLock.class));
        assertNotNull(core.services().find(PackageGate.class));
    }

    @Test public void startsLockedAndUnlocksWithARelockTime() throws Exception {
        LockdownControl control = core.services().find(LockdownControl.class);
        assertTrue("fail closed: locked before anything is read from disk", control.locked());
        JSONObject r = call("POST", "/lockdown/unlock", "{\"forMs\":60000}");
        assertEquals(200, r.getInt("_status"));
        assertFalse(r.getBoolean("locked"));
        assertTrue(r.getLong("relockAtMs") > System.currentTimeMillis());
        assertFalse(control.locked());
    }

    @Test public void anUnlockWithNoDurationStillGetsARelockTime() throws Exception {
        long before = System.currentTimeMillis();
        JSONObject r = call("POST", "/lockdown/unlock", null);
        long relockAt = r.getLong("relockAtMs");
        assertTrue(relockAt >= before + HOUR && relockAt <= System.currentTimeMillis() + HOUR);
    }

    @Test public void lockLocksAgain() throws Exception {
        call("POST", "/lockdown/unlock", "{\"forMs\":60000}");
        JSONObject r = call("POST", "/lockdown/lock", null);
        assertEquals(200, r.getInt("_status"));
        assertTrue(r.getBoolean("locked"));
        assertTrue(core.services().find(LockdownControl.class).locked());
    }

    @Test public void aBadDurationIsABadRequest() throws Exception {
        assertEquals(400, call("POST", "/lockdown/unlock", "{\"forMs\":-5}").getInt("_status"));
        assertEquals(400, call("POST", "/lockdown/unlock", "{\"forMs\":\"soon\"}").getInt("_status"));
        assertEquals(400, call("POST", "/lockdown/unlock", "{\"forMs\":0}").getInt("_status"));
        assertTrue("a refused unlock unlocks nothing", core.services().find(LockdownControl.class).locked());
    }

    @Test public void disabledLockdownIsNeverLockedAndRefusesToLock() throws Exception {
        core.settings().set("lockdown.enabled", false);
        assertFalse(core.services().find(LockdownControl.class).locked());
        JSONObject r = call("POST", "/lockdown/lock", null);
        assertEquals(501, r.getInt("_status"));
        assertEquals("lockdown.enabled is false", r.getString("reason"));
    }

    @Test public void disabledLockdownRefusesToUnlockForTheSameReason() throws Exception {
        core.settings().set("lockdown.enabled", false);
        for (String body : new String[] { null, "{}", "{\"forMs\":60000}" }) {
            JSONObject r = call("POST", "/lockdown/unlock", body);
            assertEquals(501, r.getInt("_status"));
            assertEquals("unsupported", r.getString("error"));
            assertEquals("lockdown.enabled is false", r.getString("reason"));
        }
        // Nothing was unlocked behind the refusal: switching lockdown on finds it locked.
        core.settings().set("lockdown.enabled", true);
        assertTrue(core.services().find(LockdownControl.class).locked());
        assertFalse(call("GET", "/lockdown", null).has("relockAtMs"));
    }

    @Test public void aTimedExemptionCanBeRevoked() throws Exception {
        LockdownControl control = core.services().find(LockdownControl.class);
        control.allowFor("com.example.installer", 60_000);
        assertEquals(1, call("GET", "/lockdown", null).getJSONArray("exemptions").length());
        control.revoke("com.example.installer");
        assertEquals(0, call("GET", "/lockdown", null).getJSONArray("exemptions").length());
    }

    @Test public void rebootWithoutDeviceOwnerIsUnsupported() {
        try {
            core.services().find(DeviceAdminAccess.class).reboot();
            fail("expected UnsupportedException");
        } catch (net.kckern.daylight.core.UnsupportedException e) {
            assertEquals("device owner required", e.getMessage());
        }
        assertFalse(core.services().find(DeviceAdminAccess.class).adminActive());
        assertFalse(core.services().find(DeviceAdminAccess.class).isOwner());
        try {
            core.services().find(DeviceAdminAccess.class).lockNow();
            fail("expected UnsupportedException");
        } catch (net.kckern.daylight.core.UnsupportedException e) {
            assertEquals("device admin required", e.getMessage());
        }
    }

    @Test public void statusIsServedFromMemoryWithEveryContractField() throws Exception {
        // No Android context exists here. If GET /lockdown made a system call it would throw:
        // the route is polled about once a second during an arcade session.
        JSONObject s = call("GET", "/lockdown", null);
        assertEquals(200, s.getInt("_status"));
        for (String field : new String[] { "locked", "mode", "homeIsKiosk", "allowedApps", "foreground",
                "foregroundActivity", "kioskInForeground", "recallsSinceBoot", "lastRecall" }) {
            assertTrue("missing " + field, s.has(field));
        }
        assertTrue(s.getBoolean("locked"));
        assertEquals("app", s.getString("mode"));
        assertTrue("unknown foreground is null, never a guess", s.isNull("foreground"));
        assertTrue(s.isNull("foregroundActivity"));
        assertFalse(s.getBoolean("kioskInForeground"));
        assertFalse(s.getBoolean("homeIsKiosk"));
        assertEquals(0, s.getInt("recallsSinceBoot"));
        assertTrue(s.isNull("lastRecall"));
    }

    @Test public void aBrokenAllowlistIsReportedAndAllowsNothing() throws Exception {
        core.settings().set("lockdown.allowedApps", "*");
        JSONObject s = call("GET", "/lockdown", null);
        assertEquals(0, s.getJSONArray("allowedApps").length());
        assertTrue(s.getString("allowedAppsError").contains("'*'"));
    }

    @Test public void aBadTimedExemptionIsRejected() {
        LockdownControl control = core.services().find(LockdownControl.class);
        try { control.allowFor("*", 1000); fail("expected IllegalArgumentException"); }
        catch (IllegalArgumentException expected) { }
    }

    // ── an unlock always has an end ───────────────────────────────────────────

    @Test public void anUnlockLongerThanTheCeilingIsCutToIt() throws Exception {
        long before = System.currentTimeMillis();
        JSONObject r = call("POST", "/lockdown/unlock", "{\"forMs\":" + (10 * HOUR) + "}");
        assertTrue(r.getLong("relockAtMs") <= System.currentTimeMillis() + HOUR);
        assertTrue(r.getLong("relockAtMs") >= before + HOUR);
    }

    @Test public void theCeilingCannotBeSwitchedOffOrRaisedPastAnHour() throws Exception {
        for (String bad : new String[] { "0", "61", "-1", "600" }) {
            JSONObject refused = call("POST", "/settings", "{\"key\":\"lockdown.maxUnlockMin\",\"value\":" + bad + "}");
            assertEquals("value " + bad, 400, refused.getInt("_status"));
            assertEquals("invalid_setting", refused.getString("error"));
        }
        core.settings().set("lockdown.maxUnlockMin", 5);
        JSONObject r = call("POST", "/lockdown/unlock", null);
        assertTrue(r.getLong("relockAtMs") <= System.currentTimeMillis() + 5 * 60_000L);
    }

    @Test public void theUnlockRouteNeedsTheTokenLikeEveryRoute() {
        Router.Response r = core.router().dispatch("POST", "/lockdown/unlock", "wrong-token", Collections.emptyMap(), "{}");
        assertEquals(401, r.status);
        assertTrue(core.services().find(LockdownControl.class).locked());
        assertEquals(401, core.router().dispatch("POST", "/lockdown/unlock", null, Collections.emptyMap(), "{}").status);
        assertEquals(200, core.router().dispatch("POST", "/lockdown/unlock", FakeShell.TOKEN, Collections.emptyMap(), "{}").status);
    }

    @Test public void theModeSettingTakesOnlyItsThreeValues() throws Exception {
        assertEquals(400, call("POST", "/settings", "{\"key\":\"lockdown.mode\",\"value\":\"kiosk\"}").getInt("_status"));
        core.settings().set("lockdown.mode", "owner");
        JSONObject s = call("GET", "/lockdown", null);
        assertEquals("not device owner, so app mode is what runs", "app", s.getString("mode"));
        assertTrue(s.getString("modeError").contains("not device owner"));
    }

    @Test public void theExitPinIsASecret() throws Exception {
        core.settings().set("lockdown.exitPin", "2468");
        String listed = call("GET", "/settings", null).toString();
        assertFalse(listed.contains("2468"));
        assertFalse(call("GET", "/lockdown", null).toString().contains("2468"));
    }

    // ── a real start, over a fake Android context ─────────────────────────────

    @Test public void aRealStartTakesWhatItNeedsAndStopGivesItBack() throws Exception {
        File dir = tmp.newFolder();
        FakeContext ctx = new FakeContext(dir);
        int busBefore;
        cap.stop();
        core = TestCore.createWithContext(dir, ctx);
        FakeSurface surface = new FakeSurface();
        core.services().provide(KioskSurface.class, surface);
        cap = new LockdownCapability();
        core.add(cap);
        core.prepare(new JSONObject());
        busBefore = core.events().subscribers();
        assertEquals(0, core.accessibility().eventListenerCount());
        assertFalse("nothing is enforced before the start", core.services().find(PackageGate.class).ready());

        cap.start();
        assertEquals("the watcher's timer runs", 1, FakeContext.liveThreads("daylight-lockdown"));
        assertEquals("hears the kiosk window lose focus", busBefore + 1, core.events().subscribers());
        assertEquals("hears window events from the accessibility service", 1, core.accessibility().eventListenerCount());
        assertNotNull("watches touches for the exit gesture", surface.touches);
        assertEquals("locked: immersive is asked of the kiosk window", Boolean.TRUE, surface.immersive);
        assertTrue(core.services().find(PackageGate.class).ready());
        assertEquals("running", call("GET", "/lockdown", null).getString("watcher"));

        cap.stop();
        long deadline = System.currentTimeMillis() + 3000;
        while (FakeContext.liveThreads("daylight-lockdown") > 0 && System.currentTimeMillis() < deadline) Thread.sleep(20);
        assertEquals(0, FakeContext.liveThreads("daylight-lockdown"));
        assertEquals(busBefore, core.events().subscribers());
        assertEquals(0, core.accessibility().eventListenerCount());
        assertNull(surface.touches);
        assertFalse(core.services().find(PackageGate.class).ready());
        assertEquals("stopped", call("GET", "/lockdown", null).getString("watcher"));
        cap.stop();
        assertEquals(0, core.accessibility().eventListenerCount());
    }

    @Test public void startWithoutAnAndroidContextDoesNothingAndStopTwiceIsSafe() throws Exception {
        cap.start();
        assertEquals(0, FakeContext.liveThreads("daylight-lockdown"));
        assertEquals("stopped", call("GET", "/lockdown", null).getString("watcher"));
        cap.stop();
        cap.stop();
    }

    // ── the watcher fails closed ──────────────────────────────────────────────

    @Test public void withNoWatcherAndTheKioskNotInFrontTheKioskIsRecalled() throws Exception {
        File dir = tmp.newFolder();
        FakeSurface surface = startForReal(new FakeContext(dir), dir);
        // No accessibility service is bound and the display's state cannot be read:
        // nothing says what is in front, so the kiosk is brought back.
        cap.tick(1_000_000);
        assertEquals(1, surface.broughtToFront);
        JSONObject s = call("GET", "/lockdown", null);
        assertEquals(1, s.getInt("recallsSinceBoot"));
        assertEquals("foreground unknown", s.getJSONObject("lastRecall").getString("reason"));
        assertTrue(s.isNull("foreground"));
        cap.tick(1_001_000);
        assertEquals("a recall that did not take is retried on the next tick", 2, surface.broughtToFront);
    }

    @Test public void theKioskInFrontIsNeverRecalledAndReportsItself() throws Exception {
        File dir = tmp.newFolder();
        FakeSurface surface = startForReal(new FakeContext(dir), dir);
        surface.resumed = true;
        cap.tick(1_000_000);
        assertEquals(0, surface.broughtToFront);
        JSONObject s = call("GET", "/lockdown", null);
        assertTrue(s.getBoolean("kioskInForeground"));
        assertEquals("net.kckern.daylight.test", s.getString("foreground"));
        assertEquals(LockdownCapability.KIOSK_ACTIVITY, s.getString("foregroundActivity"));
        assertEquals("net.kckern.daylight.test", core.services().find(LockdownControl.class).front());
    }

    @Test public void anUnlockStopsRecallsUntilItEnds() throws Exception {
        File dir = tmp.newFolder();
        FakeSurface surface = startForReal(new FakeContext(dir), dir);
        long relockAt = call("POST", "/lockdown/unlock", "{\"forMs\":60000}").getLong("relockAtMs");
        assertEquals(Boolean.FALSE, surface.immersive);
        cap.tick(relockAt - 1);
        assertEquals(0, surface.broughtToFront);
        cap.tick(relockAt);
        assertTrue("the tick that ends the window locks again", core.services().find(LockdownControl.class).locked());
        assertEquals(1, surface.broughtToFront);
        assertEquals(Boolean.TRUE, surface.immersive);
    }

    @Test public void anUnlockSurvivesARestartAndAStoredOneWithNoEndDoesNot() throws Exception {
        File dir = tmp.newFolder();
        startForReal(new FakeContext(dir), dir);
        call("POST", "/lockdown/unlock", "{\"forMs\":60000}");
        cap.stop();
        cap = new LockdownCapability();
        cap.register(TestCore.createWithContext(dir, new FakeContext(dir)));
        cap.start();
        assertFalse("the unlock window was read back", cap.locked());
        cap.stop();

        File state = new File(dir, "state/lockdown.json");
        assertTrue(state.isFile());
        java.nio.file.Files.write(state.toPath(), "{\"locked\":false,\"unlockedAtMs\":1,\"relockAtMs\":0}".getBytes("UTF-8"));
        cap = new LockdownCapability();
        cap.register(TestCore.createWithContext(dir, new FakeContext(dir)));
        cap.start();
        assertTrue("an unlock with no end reads as locked", cap.locked());
        cap.stop();
        java.nio.file.Files.write(state.toPath(), "not json".getBytes("UTF-8"));
        cap = new LockdownCapability();
        cap.register(TestCore.createWithContext(dir, new FakeContext(dir)));
        cap.start();
        assertTrue("an unreadable state reads as locked", cap.locked());
    }

    @Test public void disabledLockdownRecallsNothing() throws Exception {
        File dir = tmp.newFolder();
        FakeSurface surface = startForReal(new FakeContext(dir), dir);
        core.settings().set("lockdown.enabled", false);
        cap.tick(1_000_000);
        assertEquals(0, surface.broughtToFront);
        assertFalse(core.services().find(PackageGate.class).ready());
    }

    // ── the exit gesture ──────────────────────────────────────────────────────

    private static void sevenTaps(FakeSurface surface) {
        for (int i = 0; i < 7; i++) surface.touches.onTouchDown(10, 10, 1280, 800);
    }

    @Test public void withNoPinTheGestureDoesNothing() throws Exception {
        File dir = tmp.newFolder();
        FakeSurface surface = startForReal(new FakeContext(dir), dir);
        sevenTaps(surface);
        assertNull("no PIN, no prompt: the way out is the API", surface.prompt);
    }

    @Test public void theGestureAsksForThePinAndOnlyTheRightOneUnlocks() throws Exception {
        File dir = tmp.newFolder();
        FakeSurface surface = startForReal(new FakeContext(dir), dir);
        core.settings().set("lockdown.exitPin", "2468");
        sevenTaps(surface);
        assertNotNull(surface.prompt);
        surface.prompt.onPin("1111");
        assertTrue(cap.locked());
        surface.prompt.onPin("2468");
        assertFalse(cap.locked());
        long relockAt = call("GET", "/lockdown", null).getLong("relockAtMs");
        assertTrue("a PIN unlock ends too", relockAt <= System.currentTimeMillis() + HOUR);
        for (String note : ((FakeShell) core.shell()).notes) {
            assertFalse("the PIN is never written to the log", note.contains("2468") || note.contains("1111"));
        }
    }

    @Test public void aPinUnlockIsShorterThanAnApiUnlock() throws Exception {
        File dir = tmp.newFolder();
        FakeSurface surface = startForReal(new FakeContext(dir), dir);
        core.settings().set("lockdown.exitPin", "2468");
        long before = System.currentTimeMillis();
        sevenTaps(surface);
        surface.prompt.onPin("2468");
        long relockAt = call("GET", "/lockdown", null).getLong("relockAtMs");
        assertTrue("ten minutes by default, not the hour an API unlock gets",
                relockAt >= before + 10 * 60_000L && relockAt <= System.currentTimeMillis() + 10 * 60_000L);

        // The API unlock keeps its own length, up to the ceiling.
        call("POST", "/lockdown/lock", null);
        long api = call("POST", "/lockdown/unlock", "{\"forMs\":" + (45 * 60_000L) + "}").getLong("relockAtMs");
        assertTrue(api >= before + 45 * 60_000L);
        assertTrue(call("POST", "/lockdown/unlock", null).getLong("relockAtMs") >= before + HOUR);
    }

    @Test public void thePinUnlockLengthIsASettingHeldToOneToSixtyMinutesAndToTheCeiling() throws Exception {
        for (String bad : new String[] { "0", "61", "-1" }) {
            JSONObject refused = call("POST", "/settings", "{\"key\":\"lockdown.pinUnlockMin\",\"value\":" + bad + "}");
            assertEquals("value " + bad, 400, refused.getInt("_status"));
            assertEquals("invalid_setting", refused.getString("error"));
        }
        File dir = tmp.newFolder();
        FakeSurface surface = startForReal(new FakeContext(dir), dir);
        core.settings().set("lockdown.exitPin", "2468");
        core.settings().set("lockdown.pinUnlockMin", 3);
        long before = System.currentTimeMillis();
        sevenTaps(surface);
        surface.prompt.onPin("2468");
        long relockAt = call("GET", "/lockdown", null).getLong("relockAtMs");
        assertTrue(relockAt >= before + 3 * 60_000L && relockAt <= System.currentTimeMillis() + 3 * 60_000L);

        // A PIN unlock never outlasts the ceiling, whatever the two settings say.
        call("POST", "/lockdown/lock", null);
        core.settings().set("lockdown.pinUnlockMin", 30);
        core.settings().set("lockdown.maxUnlockMin", 2);
        sevenTaps(surface);
        surface.prompt.onPin("2468");
        assertTrue(call("GET", "/lockdown", null).getLong("relockAtMs") <= System.currentTimeMillis() + 2 * 60_000L);
    }

    @Test public void fiveWrongPinsLockThePromptOut() throws Exception {
        File dir = tmp.newFolder();
        FakeSurface surface = startForReal(new FakeContext(dir), dir);
        core.settings().set("lockdown.exitPin", "2468");
        sevenTaps(surface);
        for (int i = 0; i < ExitGesture.MAX_WRONG; i++) surface.prompt.onPin("0000");
        surface.prompt.onPin("2468");
        assertTrue("the right PIN is refused during the lockout", cap.locked());
    }

    @Test public void thePinLockoutIsLoggedAsAWarningOnceAndNeverWithThePin() throws Exception {
        File dir = tmp.newFolder();
        FakeSurface surface = startForReal(new FakeContext(dir), dir);
        core.settings().set("lockdown.exitPin", "2468");
        final java.util.List<JSONObject> warnings = new java.util.ArrayList<>();
        core.events().subscribe((topic, detail) -> {
            if ("lockdown".equals(topic) && "warn".equals(detail.optString("level"))) warnings.add(detail);
        });
        sevenTaps(surface);
        for (int i = 0; i < ExitGesture.MAX_WRONG - 1; i++) surface.prompt.onPin("0000");
        assertTrue("four wrong PINs are not a lockout", warnings.isEmpty());
        surface.prompt.onPin("0000");
        assertEquals(1, warnings.size());
        assertEquals("lockdown.pin.lockout", warnings.get(0).getString("event"));
        JSONObject data = warnings.get(0).getJSONObject("data");
        assertEquals(ExitGesture.MAX_WRONG, data.getInt("wrongAttempts"));
        assertTrue(data.getLong("untilMs") > System.currentTimeMillis());
        surface.prompt.onPin("2468");           // refused: locked out
        surface.prompt.onPin("0000");
        assertEquals("attempts during the lockout add no second warning", 1, warnings.size());

        String events = call("GET", "/log", null).getJSONArray("events").toString();
        assertTrue("the lockout is in the event log", events.contains("lockdown.pin.lockout"));
        String everything = events + warnings + ((FakeShell) core.shell()).notes;
        assertFalse("neither the PIN nor what was typed is logged", everything.contains("2468") || everything.contains("0000"));
    }

    // ── the package gate (lease-gate) ─────────────────────────────────────────

    @Test public void theGateKeepsAClosedPackageFromTheFrontAndSaysItCannotHideIt() throws Exception {
        File dir = tmp.newFolder();
        startForReal(new FakeContext(dir), dir);
        PackageGate gate = core.services().find(PackageGate.class);
        assertTrue(gate.ready());
        assertFalse(gate.isHidden("com.example.game"));
        assertTrue(gate.setHidden("com.example.game", true));
        assertTrue(gate.isHidden("com.example.game"));
        assertNotNull("not device owner: the package is recalled, not hidden", gate.hidingUnsupportedReason());
        JSONObject s = call("GET", "/lockdown", null);
        assertEquals("com.example.game", s.getJSONArray("blockedPackages").getString(0));
        assertFalse(s.getJSONObject("packageHiding").getBoolean("supported"));
        assertTrue(gate.setHidden("com.example.game", false));
        assertFalse(gate.isHidden("com.example.game"));
    }

    @Test public void theGateIsNotReadyWhileTheKioskIsUnlocked() throws Exception {
        File dir = tmp.newFolder();
        startForReal(new FakeContext(dir), dir);
        call("POST", "/lockdown/unlock", "{\"forMs\":60000}");
        assertFalse("nothing is recalled during an unlock, so nothing is enforced",
                core.services().find(PackageGate.class).ready());
    }

    // ── the input lock (volume-keys) ──────────────────────────────────────────

    @Test public void theInputLockFollowsOrderedCommandsAndSurvivesARestart() throws Exception {
        File dir = tmp.newFolder();
        startForReal(new FakeContext(dir), dir);
        InputLock lock = core.services().find(InputLock.class);
        assertFalse(lock.active());
        JSONObject r = call("POST", "/lockdown/input", "{\"locked\":true,\"revision\":4}");
        assertEquals(200, r.getInt("_status"));
        assertTrue(r.getBoolean("inputLocked"));
        assertEquals(4, r.getLong("revision"));
        assertTrue(lock.active());
        assertEquals(4, lock.revision());
        assertEquals("a stale command is refused", 409, call("POST", "/lockdown/input", "{\"locked\":false,\"revision\":3}").getInt("_status"));
        assertEquals(400, call("POST", "/lockdown/input", "{}").getInt("_status"));
        assertEquals(400, call("POST", "/lockdown/input", "{\"locked\":\"false\"}").getInt("_status"));
        assertTrue("a malformed command releases nothing", lock.active());

        cap.stop();
        cap = new LockdownCapability();
        CoreRuntime again = TestCore.createWithContext(dir, new FakeContext(dir));
        cap.register(again);
        cap.start();
        assertTrue(again.services().find(InputLock.class).active());
        assertEquals(4, again.services().find(InputLock.class).revision());
    }

    // ── the pairing dialog ────────────────────────────────────────────────────

    @Test public void aGrantedPairingDialogIsReportedInStatus() throws Exception {
        core.services().provide(PairingDialogExemption.class, () -> true);
        assertTrue(call("GET", "/lockdown", null).getBoolean("pairingDialogAllowed"));
    }
}
