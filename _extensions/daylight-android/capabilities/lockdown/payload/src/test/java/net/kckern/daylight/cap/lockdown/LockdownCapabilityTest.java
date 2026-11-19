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
    /** What the next startForReal compiles in, stores before start, and uses as the device's policy service. */
    private JSONObject realDefaults = new JSONObject();
    private final java.util.Map<String, Object> realOverrides = new java.util.LinkedHashMap<>();
    private DevicePolicy realPolicy;

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
    private FakeSurface startForReal(FakeContext ctx, File dir) throws Exception { return startForReal(ctx, dir, null); }

    private FakeSurface startForReal(FakeContext ctx, File dir, HomeAlias alias) throws Exception {
        cap.stop();
        core = TestCore.createWithContext(dir, ctx);
        FakeSurface surface = new FakeSurface();
        core.services().provide(KioskSurface.class, surface);
        cap = new LockdownCapability();
        core.add(cap);
        core.prepare(realDefaults);
        if (alias != null) cap.useHomeAliasForTest(alias);
        if (realPolicy != null) cap.useDevicePolicyForTest(realPolicy);
        for (java.util.Map.Entry<String, Object> e : realOverrides.entrySet()) core.settings().set(e.getKey(), e.getValue());
        cap.start();
        return surface;
    }

    // ── the HOME alias ────────────────────────────────────────────────────────

    /** The package manager's view of the alias: installed disabled. */
    private static final class FakeAlias implements HomeAlias {
        String state = DISABLED;
        String failWith;
        final java.util.List<Boolean> sets = new java.util.ArrayList<>();
        @Override public String state() { return state; }
        @Override public String set(boolean enabled) {
            sets.add(enabled);
            if (failWith != null) return failWith;
            state = enabled ? ENABLED : DISABLED;
            return null;
        }
    }

    @Test public void theHomeAliasIsReportedDisabledUntilItIsEnabledByRequest() throws Exception {
        FakeAlias alias = new FakeAlias();
        startForReal(new FakeContext(tmp.newFolder()), tmp.newFolder(), alias);
        assertEquals("installing changes nothing: the alias starts disabled", "disabled", call("GET", "/lockdown", null).getString("homeAlias"));
        assertTrue("nothing enabled it by itself", alias.sets.isEmpty());

        JSONObject on = call("POST", "/lockdown/home", "{\"enabled\":true}");
        assertEquals(200, on.getInt("_status"));
        assertEquals("enabled", on.getString("homeAlias"));
        assertEquals("enabled", call("GET", "/lockdown", null).getString("homeAlias"));

        JSONObject off = call("POST", "/lockdown/home", "{\"enabled\":false}");
        assertEquals("disabled", off.getString("homeAlias"));
        assertEquals("disabled", call("GET", "/lockdown", null).getString("homeAlias"));
        assertEquals(java.util.Arrays.asList(true, false), alias.sets);
    }

    @Test public void theHomeRouteNeedsABooleanAndReportsAFailureAsAnError() throws Exception {
        assertEquals(400, call("POST", "/lockdown/home", null).getInt("_status"));
        assertEquals(400, call("POST", "/lockdown/home", "{\"enabled\":\"yes\"}").getInt("_status"));
        assertEquals("not started: nothing to switch", 409, call("POST", "/lockdown/home", "{\"enabled\":true}").getInt("_status"));

        FakeAlias alias = new FakeAlias();
        alias.failWith = "SecurityException: refused";
        cap.useHomeAliasForTest(alias);
        JSONObject r = call("POST", "/lockdown/home", "{\"enabled\":true}");
        assertEquals(500, r.getInt("_status"));
        assertEquals("home_alias_failed", r.getString("error"));
        assertEquals("disabled", r.getString("homeAlias"));
    }

    @Test public void theHomeRouteNeedsTheToken() {
        Router.Response r = core.router().dispatch("POST", "/lockdown/home", "wrong", Collections.emptyMap(), "{\"enabled\":true}");
        assertEquals(401, r.status);
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
        for (String route : new String[] { "GET /lockdown", "POST /lockdown/lock", "POST /lockdown/unlock", "POST /lockdown/input",
                "POST /lockdown/home" }) {
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
        core.settings().set("lockdown.exitPin", "2468135791");
        final java.util.List<JSONObject> warnings = new java.util.ArrayList<>();
        core.events().subscribe((topic, detail) -> {
            if ("lockdown".equals(topic) && "warn".equals(detail.optString("level"))) warnings.add(detail);
        });
        sevenTaps(surface);
        for (int i = 0; i < ExitGesture.MAX_WRONG - 1; i++) surface.prompt.onPin("0000111122");
        assertTrue("four wrong PINs are not a lockout", warnings.isEmpty());
        surface.prompt.onPin("0000111122");
        assertEquals(1, warnings.size());
        assertEquals("lockdown.pin.lockout", warnings.get(0).getString("event"));
        JSONObject data = warnings.get(0).getJSONObject("data");
        assertEquals(ExitGesture.MAX_WRONG, data.getInt("wrongAttempts"));
        assertTrue(data.getLong("untilMs") > System.currentTimeMillis());
        surface.prompt.onPin("2468135791");           // refused: locked out
        surface.prompt.onPin("0000111122");
        assertEquals("attempts during the lockout add no second warning", 1, warnings.size());

        String events = call("GET", "/log", null).getJSONArray("events").toString();
        assertTrue("the lockout is in the event log", events.contains("lockdown.pin.lockout"));
        // Ten digits each: the log holds clock times in milliseconds, and a four-digit
        // PIN turns up inside one of those by chance about once in a few hundred runs.
        String everything = events + warnings + ((FakeShell) core.shell()).notes;
        assertFalse("neither the PIN nor what was typed is logged", everything.contains("2468135791") || everything.contains("0000111122"));
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

    @Test public void orderedLockdownWireFixturesMatchTheNativeRoute() throws Exception {
        File dir = tmp.newFolder();
        startForReal(new FakeContext(dir), dir);
        cap.useSuppressionReadyForTest(() -> true);
        try (java.io.InputStream input = getClass().getResourceAsStream("/ordered-lockdown.json");
             java.util.Scanner scanner = new java.util.Scanner(input, "UTF-8").useDelimiter("\\A")) {
            org.json.JSONArray cases = new org.json.JSONArray(scanner.next());
            for (int i = 0; i < cases.length(); i++) {
                JSONObject fixture = cases.getJSONObject(i);
                JSONObject response = call("POST", "/lockdown/input", fixture.getJSONObject("request").toString());
                assertEquals(200, response.remove("_status"));
                JSONObject expected = fixture.getJSONObject("daylight");
                java.util.Iterator<String> fields = expected.keys();
                while (fields.hasNext()) {
                    String field = fields.next();
                    assertEquals(field, expected.get(field), response.get(field));
                }
            }
        }
    }

    @Test public void theInputLockFollowsOrderedCommandsAndSurvivesARestart() throws Exception {
        File dir = tmp.newFolder();
        startForReal(new FakeContext(dir), dir);
        InputLock lock = core.services().find(InputLock.class);
        assertFalse(lock.active());
        assertFalse(call("GET", "/lockdown", null).getJSONObject("inputLock").getBoolean("inputReady"));
        assertEquals(409, call("POST", "/lockdown/input", "{\"locked\":true,\"revision\":4}").getInt("_status"));
        cap.useSuppressionReadyForTest(() -> true);
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
        File part = new File(dir, "state/input-lock.json.part");
        assertTrue(part.mkdir());
        assertEquals(500, call("POST", "/lockdown/input", "{\"locked\":false,\"revision\":5}").getInt("_status"));
        assertTrue(lock.active());
        assertEquals(4, lock.revision());

        cap.stop();
        cap = new LockdownCapability();
        CoreRuntime again = TestCore.createWithContext(dir, new FakeContext(dir));
        cap.register(again);
        cap.start();
        assertTrue(again.services().find(InputLock.class).active());
        assertEquals(4, again.services().find(InputLock.class).revision());
    }

    @Test public void identicalDurableCommandsAckWithoutAnotherWriteOrLog() throws Exception {
        File dir = tmp.newFolder();
        startForReal(new FakeContext(dir), dir);
        cap.useSuppressionReadyForTest(() -> true);
        final String release = "{\"locked\":false}";
        File file = new File(dir, "state/input-lock.json");
        File part = new File(dir, "state/input-lock.json.part");
        assertFalse(file.exists());
        assertTrue(part.mkdirs());
        assertEquals(500, call("POST", "/lockdown/input", release).getInt("_status"));
        assertTrue(part.delete());
        assertEquals(200, call("POST", "/lockdown/input", release).getInt("_status"));
        assertTrue(file.isFile());
        assertTrue(part.mkdir()); // every further write attempt would fail
        for (int i = 0; i < 3; i++) {
            JSONObject ack = call("POST", "/lockdown/input", release);
            assertEquals(200, ack.getInt("_status"));
            assertFalse(ack.getBoolean("inputLocked"));
            assertEquals(0, ack.getLong("revision"));
        }
        assertEquals(1, ((FakeShell)core.shell()).notes.stream().filter(n -> n.contains("input lock cleared")).count());
        cap.useSuppressionReadyForTest(() -> false);
        assertEquals(409, call("POST", "/lockdown/input", release).getInt("_status"));

        startForReal(new FakeContext(dir), dir);
        cap.useSuppressionReadyForTest(() -> true);
        assertEquals(200, call("POST", "/lockdown/input", release).getInt("_status"));
        assertEquals(0, ((FakeShell)core.shell()).notes.stream().filter(n -> n.contains("input lock cleared")).count());
    }

    // ── the pairing dialog ────────────────────────────────────────────────────

    @Test public void aGrantedPairingDialogIsReportedInStatus() throws Exception {
        core.services().provide(PairingDialogExemption.class, () -> true);
        assertTrue(call("GET", "/lockdown", null).getBoolean("pairingDialogAllowed"));
    }

    // ── split screen, a sample that saw nothing, a tick that throws ──────────

    private static ForegroundTrail.Win app(String pkg, boolean active) {
        return new ForegroundTrail.Win(ForegroundTrail.TYPE_APPLICATION, pkg, "", active);
    }

    private static final String OWN = "net.kckern.daylight.test";

    @Test public void settingsBesideTheResumedKioskInSplitScreenIsRecalled() throws Exception {
        File dir = tmp.newFolder();
        FakeSurface surface = startForReal(new FakeContext(dir), dir);
        surface.resumed = true;                                  // Android 10+: both halves are resumed
        cap.useWindowsForTest(() -> java.util.Arrays.asList(app(OWN, false), app("com.android.settings", true)));
        cap.tick(1_000_000);
        assertEquals("the active window is another app's: recalled although the kiosk is resumed", 1, surface.broughtToFront);
        JSONObject recall = call("GET", "/lockdown", null).getJSONObject("lastRecall");
        assertEquals("not allowed beside the kiosk: com.android.settings", recall.getString("reason"));

        // The kiosk's own window active again: nothing to do.
        cap.useWindowsForTest(() -> java.util.Arrays.asList(app(OWN, true), app("com.android.settings", false)));
        cap.tick(1_001_000);
        assertEquals(1, surface.broughtToFront);
    }

    @Test public void aSampleThatFoundNoApplicationWindowIsUnknownNotTheLastPackageSeen() throws Exception {
        File dir = tmp.newFolder();
        FakeSurface surface = startForReal(new FakeContext(dir), dir);
        cap.useKeyguardForTest(false);
        surface.resumed = true;
        cap.useWindowsForTest(() -> java.util.Collections.singletonList(app(OWN, true)));
        cap.tick(1_000_000);                                     // the last package seen is our own
        assertEquals(0, surface.broughtToFront);

        // The kiosk is gone and the window list names no application window. The stale
        // "our own package" must not stand in for what this sample could not see.
        surface.resumed = false;
        cap.useWindowsForTest(java.util.Collections::emptyList);
        cap.tick(1_001_000);
        assertEquals("fail closed", 1, surface.broughtToFront);
        assertEquals("foreground unknown", call("GET", "/lockdown", null).getJSONObject("lastRecall").getString("reason"));
    }

    @Test public void anUnknownFrontUnderTheKeyguardIsNotRecalledOver() throws Exception {
        File dir = tmp.newFolder();
        FakeSurface surface = startForReal(new FakeContext(dir), dir);
        cap.useKeyguardForTest(true);
        cap.useWindowsForTest(java.util.Collections::emptyList);
        cap.tick(1_000_000);
        assertEquals(0, surface.broughtToFront);
    }

    @Test public void aTickThatThrowsStillEndsInARecall() throws Exception {
        File dir = tmp.newFolder();
        FakeSurface surface = startForReal(new FakeContext(dir), dir);
        cap.useWindowsForTest(() -> { throw new IllegalStateException("window service died"); });
        cap.tickSafely(1_000_000);
        assertEquals("the watcher could not see: it recalls", 1, surface.broughtToFront);
        assertEquals("watcher failed", call("GET", "/lockdown", null).getJSONObject("lastRecall").getString("reason"));
        assertTrue(((FakeShell) core.shell()).notes.toString().contains("tick failed"));
    }

    @Test public void aTickThatThrowsWhileUnlockedRecallsNothing() throws Exception {
        File dir = tmp.newFolder();
        FakeSurface surface = startForReal(new FakeContext(dir), dir);
        call("POST", "/lockdown/unlock", "{\"forMs\":60000}");
        cap.useWindowsForTest(() -> { throw new IllegalStateException("window service died"); });
        cap.tickSafely(System.currentTimeMillis());
        assertEquals(0, surface.broughtToFront);
    }

    @Test public void aRecallThatCannotSucceedBacksOffAndIsCounted() throws Exception {
        File dir = tmp.newFolder();
        FakeSurface surface = startForReal(new FakeContext(dir), dir);
        // Accessibility unbound: every tick wants a recall and none of them takes.
        for (int i = 0; i < 60; i++) cap.tick(1_000_000 + i * 1_000L);
        assertTrue("three at once, then 2, 4, 8, 16, 30 s apart: " + surface.broughtToFront,
                surface.broughtToFront >= RecallPacer.FREE && surface.broughtToFront <= 9);
        JSONObject status = call("GET", "/lockdown", null);
        assertEquals(60 - surface.broughtToFront, status.getInt("recallsHeldBack"));
    }

    @Test public void aRecallWithAccessibilityUnboundSaysItWasNotVerified() throws Exception {
        File dir = tmp.newFolder();
        startForReal(new FakeContext(dir), dir);
        cap.tick(1_000_000);
        JSONObject recall = call("GET", "/lockdown", null).getJSONObject("lastRecall");
        assertFalse(recall.getBoolean("a11yBound"));
        assertEquals("a start from the service is asked for, never known to have worked",
                "service-start-unverified", recall.getString("how"));
    }

    // ── lockdown.required, and settings applied when they change ─────────────

    @Test public void requiredIsEnforcedWhateverEnabledSaysAndWithNoOverridesAtAll() throws Exception {
        realDefaults = new JSONObject("{\"lockdown.required\":true,\"lockdown.enabled\":false}");
        File dir = tmp.newFolder();
        FakeSurface surface = startForReal(new FakeContext(dir), dir);
        // This is the state after a lifeline settings reset, or after the overrides file
        // was lost: no override anywhere, and the compiled lockdown.enabled is false.
        assertTrue(core.services().find(LockdownControl.class).locked());
        JSONObject status = call("GET", "/lockdown", null);
        assertTrue(status.getBoolean("locked"));
        assertTrue(status.getBoolean("required"));
        assertFalse(status.getBoolean("enabled"));
        cap.tick(1_000_000);
        assertEquals("and the watcher recalls", 1, surface.broughtToFront);
    }

    @Test public void requiredCannotBeSwitchedOffThroughTheSettingsRoute() throws Exception {
        realDefaults = new JSONObject("{\"lockdown.required\":true}");
        File dir = tmp.newFolder();
        startForReal(new FakeContext(dir), dir);
        JSONObject off = call("POST", "/settings", "{\"key\":\"lockdown.enabled\",\"value\":false}");
        assertEquals(400, off.getInt("_status"));
        assertEquals("invalid_setting", off.getString("error"));
        assertTrue(off.getString("message"), off.getString("message").contains("lockdown.required"));
        assertTrue("it says what to do instead", off.getString("message").contains("/lockdown/unlock"));

        JSONObject required = call("POST", "/settings", "{\"key\":\"lockdown.required\",\"value\":false}");
        assertEquals(400, required.getInt("_status"));
        assertTrue(required.getString("message").contains("device file"));
        assertTrue(core.services().find(LockdownControl.class).locked());

        // Only an unlock relaxes it, and that always ends.
        JSONObject unlocked = call("POST", "/lockdown/unlock", "{\"forMs\":60000}");
        assertEquals(200, unlocked.getInt("_status"));
        assertTrue(unlocked.getLong("relockAtMs") > 0);
        assertFalse(core.services().find(LockdownControl.class).locked());
    }

    @Test public void withoutRequiredLockdownEnabledCanStillBeTurnedOff() throws Exception {
        JSONObject off = call("POST", "/settings", "{\"key\":\"lockdown.enabled\",\"value\":false}");
        assertEquals(200, off.getInt("_status"));
        assertFalse(core.services().find(LockdownControl.class).locked());
    }

    @Test public void turningLockdownOffAtRunTimeIsAppliedAtOnce() throws Exception {
        File dir = tmp.newFolder();
        FakeSurface surface = startForReal(new FakeContext(dir), dir);
        assertEquals(Boolean.TRUE, surface.immersive);
        core.settings().set("lockdown.enabled", false);
        assertEquals("immersive is given up without a payload restart", Boolean.FALSE, surface.immersive);
        core.settings().set("lockdown.enabled", true);
        assertEquals(Boolean.TRUE, surface.immersive);
    }

    // ── owner mode ───────────────────────────────────────────────────────────

    @Test public void turningLockdownOffInOwnerModeLeavesLockTaskAndGivesTheStatusBarBack() throws Exception {
        FakeDevicePolicy policy = new FakeDevicePolicy();
        realPolicy = policy;
        realOverrides.put("lockdown.exitPin", "4711");
        File dir = tmp.newFolder();
        FakeSurface surface = startForReal(new FakeContext(dir), dir);
        assertEquals("owner", call("GET", "/lockdown", null).getString("mode"));
        assertTrue(policy.statusBarDisabled);
        assertTrue(policy.lockTaskPackages.contains(OWN));
        assertEquals(1, surface.lockTaskOn);

        core.settings().set("lockdown.enabled", false);
        assertEquals(1, surface.lockTaskOff);
        assertFalse("the status bar comes back without a payload restart", policy.statusBarDisabled);
        assertTrue(policy.lockTaskPackages.isEmpty());
    }

    @Test public void ownerModeDoesNotLockWithoutAnExitPinAndSaysWhy() throws Exception {
        FakeDevicePolicy policy = new FakeDevicePolicy();
        realPolicy = policy;
        File dir = tmp.newFolder();
        FakeSurface surface = startForReal(new FakeContext(dir), dir);
        JSONObject status = call("GET", "/lockdown", null);
        assertEquals("owner", status.getString("mode"));
        assertTrue(status.getString("ownerRefused"), status.getString("ownerRefused").contains("lockdown.exitPin"));
        assertEquals("no lock task", 0, surface.lockTaskOn);
        assertFalse(policy.statusBarDisabled);
        assertTrue("nothing is on the lock-task list: " + policy.calls, policy.lockTaskPackages.isEmpty());
        assertFalse(policy.keyguardDisabled);
        assertTrue(((FakeShell) core.shell()).notes.toString().contains("lockdown.exitPin is empty"));
        assertTrue("lockdown itself still holds, in app mode's way", status.getBoolean("locked"));
        assertEquals(Boolean.TRUE, surface.immersive);

        // Setting the PIN is applied at once.
        // Ten digits, so a clock time in an answer cannot contain it by chance.
        core.settings().set("lockdown.exitPin", "4711047110");
        assertTrue(policy.statusBarDisabled);
        assertEquals(1, surface.lockTaskOn);
        assertFalse(call("GET", "/lockdown", null).has("ownerRefused"));
        assertFalse("the PIN is never in an answer or a log line", call("GET", "/lockdown", null).toString().contains("4711047110"));
        assertFalse(((FakeShell) core.shell()).notes.toString().contains("4711047110"));
    }

    // ── releasing and transferring device ownership ──────────────────────────

    private static final String OLD_OWNER = "net.kckern.portalkeys/net.kckern.portalkeys.PortalAdminReceiver";

    /** Owner mode, locked, with an exit PIN, the HOME alias enabled and the Portal's hide list. */
    private FakeDevicePolicy lockedAsOwner(File dir) throws Exception {
        FakeDevicePolicy policy = new FakeDevicePolicy();
        realPolicy = policy;
        realOverrides.put("lockdown.exitPin", "4711");
        realDefaults = new JSONObject("{\"lockdown.ownerRestrictions\":true,\"lockdown.ownerHidePackages\":\"com.android.chrome,com.android.systemui\"}");
        FakeAlias alias = new FakeAlias();
        alias.state = HomeAlias.ENABLED;
        startForReal(new FakeContext(dir), dir, alias);
        return policy;
    }

    @Test public void ownerReleaseUndoesEveryPolicyAndStaysReleased() throws Exception {
        File dir = tmp.newFolder();
        String untouched = new FakeDevicePolicy().state();
        FakeDevicePolicy policy = lockedAsOwner(dir);
        assertFalse("the device is under owner policy", untouched.equals(policy.state()));
        assertEquals(1, policy.preferredHome.size());

        JSONObject r = call("POST", "/lockdown/owner/release", null);
        assertEquals(200, r.getInt("_status"));
        assertTrue(r.getBoolean("released"));
        assertEquals("the device is as it was before this app held it", untouched, policy.state());
        assertTrue(policy.calls.contains("clearPersistentPreferredActivities " + OWN));

        // The watcher re-applies owner policy every five seconds. Not while it is released.
        for (int i = 1; i <= 12; i++) cap.tick(1_000_000 + i * 1_000L);
        assertEquals(untouched, policy.state());
        JSONObject status = call("GET", "/lockdown", null);
        assertEquals("app", status.getString("mode"));
        assertEquals("released by request", status.getString("ownerHold"));
        assertTrue("it is still the owner; it has stopped acting as one", status.getBoolean("deviceOwner"));
        assertTrue("and lockdown itself still holds, in app mode's way", status.getBoolean("locked"));
    }

    @Test public void aReleaseSurvivesAPayloadRestartAndResumeAppliesPolicyAgain() throws Exception {
        File dir = tmp.newFolder();
        FakeDevicePolicy policy = lockedAsOwner(dir);
        call("POST", "/lockdown/owner/release", null);
        String released = policy.state();

        // The next payload over the same state directory.
        FakeDevicePolicy next = lockedAsOwner(dir);
        assertEquals("the hold is on disk: the new payload applies nothing", released, next.state());
        assertEquals("app", call("GET", "/lockdown", null).getString("mode"));

        JSONObject resumed = call("POST", "/lockdown/owner/resume", null);
        assertEquals(200, resumed.getInt("_status"));
        assertEquals("owner", resumed.getString("mode"));
        assertTrue(next.statusBarDisabled);
        assertEquals(1, next.preferredHome.size());
        assertTrue(call("GET", "/lockdown", null).isNull("ownerHold"));
    }

    @Test public void ownerReleaseIsRefusedWhenThereIsNothingToRelease() throws Exception {
        assertEquals("not started", 409, call("POST", "/lockdown/owner/release", null).getInt("_status"));
        FakeDevicePolicy policy = new FakeDevicePolicy();
        policy.owner = false;
        realPolicy = policy;
        File dir = tmp.newFolder();
        startForReal(new FakeContext(dir), dir);
        JSONObject r = call("POST", "/lockdown/owner/release", null);
        assertEquals(409, r.getInt("_status"));
        assertEquals("not_device_owner", r.getString("error"));
        assertTrue(policy.calls.isEmpty());
        assertEquals(401, core.router().dispatch("POST", "/lockdown/owner/release", "wrong", Collections.emptyMap(), null).status);
    }

    @Test public void transferIsRefusedUnlessTheTargetIsTheOneThisDeviceNames() throws Exception {
        File dir = tmp.newFolder();
        FakeDevicePolicy policy = lockedAsOwner(dir);
        String applied = policy.state();
        // The default: no target is configured, so nothing may be transferred anywhere.
        JSONObject unset = call("POST", "/lockdown/owner/transfer", "{\"to\":\"" + OLD_OWNER + "\"}");
        assertEquals(409, unset.getInt("_status"));
        assertEquals("transfer_not_configured", unset.getString("error"));

        core.settings().set("lockdown.ownerTransferTarget", OLD_OWNER);
        JSONObject other = call("POST", "/lockdown/owner/transfer", "{\"to\":\"com.example.game/com.example.game.Admin\"}");
        assertEquals(409, other.getInt("_status"));
        assertEquals("target_not_allowed", other.getString("error"));
        assertEquals(400, call("POST", "/lockdown/owner/transfer", "{}").getInt("_status"));
        assertEquals(400, call("POST", "/lockdown/owner/transfer", "{\"to\":\"not a component\"}").getInt("_status"));
        assertEquals(401, core.router().dispatch("POST", "/lockdown/owner/transfer", "wrong", Collections.emptyMap(), "{}").status);

        assertNull("nothing was transferred", policy.transferredTo);
        assertEquals("and no policy was touched by a refused request", applied, policy.state());
    }

    @Test public void transferReleasesThisAppsPolicyFirstAndThenHandsOwnershipOver() throws Exception {
        File dir = tmp.newFolder();
        String untouched = new FakeDevicePolicy().state();
        FakeDevicePolicy policy = lockedAsOwner(dir);
        core.settings().set("lockdown.ownerTransferTarget", OLD_OWNER);
        policy.calls.clear();

        JSONObject r = call("POST", "/lockdown/owner/transfer", "{\"to\":\"net.kckern.portalkeys/.PortalAdminReceiver\"}");
        assertEquals(200, r.getInt("_status"));
        assertTrue(r.getBoolean("transferred"));
        assertEquals(OLD_OWNER, r.getString("to"));
        assertFalse(r.getBoolean("deviceOwner"));
        assertEquals(OLD_OWNER, policy.transferredTo);
        assertEquals("the receiving app starts from a clean device", untouched, policy.state());
        int transfer = policy.calls.indexOf("transferOwnership " + OLD_OWNER);
        assertEquals("the transfer is the last call, after the whole release", policy.calls.size() - 1, transfer);
        assertTrue(policy.calls.indexOf("clearPersistentPreferredActivities " + OWN) < transfer);
    }

    @Test public void aTransferTheSystemRefusesIsReportedAndThePolicyStaysReleased() throws Exception {
        File dir = tmp.newFolder();
        String untouched = new FakeDevicePolicy().state();
        FakeDevicePolicy policy = lockedAsOwner(dir);
        core.settings().set("lockdown.ownerTransferTarget", OLD_OWNER);
        policy.transferFails = new IllegalArgumentException("Provided new admin does not support transfer");

        JSONObject r = call("POST", "/lockdown/owner/transfer", "{\"to\":\"" + OLD_OWNER + "\"}");
        assertEquals(500, r.getInt("_status"));
        assertEquals("transfer_failed", r.getString("error"));
        assertEquals("IllegalArgumentException", r.getString("exception"));
        assertFalse(r.getBoolean("transferred"));
        assertTrue(r.getBoolean("policyReleased"));
        assertTrue("still the owner", policy.owner);
        for (int i = 1; i <= 6; i++) cap.tick(2_000_000 + i * 1_000L);
        assertEquals("the policy is not put back behind the operator's back", untouched, policy.state());
    }

    @Test public void onAnOlderAndroidTransferIsUnsupportedAndNothingIsReleased() throws Exception {
        File dir = tmp.newFolder();
        FakeDevicePolicy policy = lockedAsOwner(dir);
        policy.sdk = 27;
        String applied = policy.state();
        core.settings().set("lockdown.ownerTransferTarget", OLD_OWNER);
        JSONObject r = call("POST", "/lockdown/owner/transfer", "{\"to\":\"" + OLD_OWNER + "\"}");
        assertEquals(501, r.getInt("_status"));
        assertEquals(applied, policy.state());
    }

    @Test public void ownershipThatArrivesWithAHoldAppliesNothingUntilResume() throws Exception {
        // What the admin receiver does when ownership is transferred to this app.
        File dir = tmp.newFolder();
        net.kckern.daylight.api.OwnerHold.set(dir, "device ownership was transferred to this app");
        String untouched = new FakeDevicePolicy().state();
        FakeDevicePolicy policy = lockedAsOwner(dir);
        for (int i = 1; i <= 6; i++) cap.tick(3_000_000 + i * 1_000L);
        assertEquals(untouched, policy.state());
        assertEquals("app", call("GET", "/lockdown", null).getString("mode"));
    }
}
