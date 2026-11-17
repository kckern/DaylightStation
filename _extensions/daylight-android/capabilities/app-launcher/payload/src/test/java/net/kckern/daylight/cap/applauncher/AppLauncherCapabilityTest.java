package net.kckern.daylight.cap.applauncher;

import static org.junit.Assert.*;

import net.kckern.daylight.core.CoreRuntime;
import net.kckern.daylight.core.spi.AppLaunch;
import net.kckern.daylight.core.spi.LockdownControl;
import net.kckern.daylight.core.spi.PackageGate;
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
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class AppLauncherCapabilityTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();
    private CoreRuntime core;
    private AppLauncherCapability cap;
    private final List<String> order = new ArrayList<>();

    /** A device with a few installed apps. Every start is recorded; nothing is started that the test did not see. */
    private final class FakePlatform implements AppLauncherCapability.Platform {
        /** What a request's package, or a whole intent: URI, resolves to: "package/class". */
        final Map<String, String> installed = new HashMap<>();
        boolean refuseStart;

        @Override public AppLauncherCapability.Target resolve(LaunchRequest request) {
            String key = request.intentUri != null ? request.intentUri : request.pkg;
            String component = installed.get(key);
            if (component == null) return null;
            String[] parts = component.split("/");
            return new AppLauncherCapability.Target(parts[0], parts[1], request);
        }

        @Override public boolean start(AppLauncherCapability.Target target) {
            order.add("start " + target.component());
            return !refuseStart;
        }
    }

    /** Lockdown, as far as the launcher uses it. */
    private final class FakeLockdown implements LockdownControl {
        volatile String front;
        @Override public boolean locked() { return true; }
        @Override public String front() { return front; }
        @Override public String frontActivity() { return null; }
        @Override public String lastAway() { return null; }
        @Override public void allowWhileInFront(String packageName) { order.add("allow " + packageName); }
        @Override public void allowFor(String rule, long durationMs) { }
        @Override public void revoke(String rule) { }
        @Override public boolean recall(long waitMs) { return true; }
    }

    private FakePlatform platform;

    @Before public void setUp() throws Exception {
        core = TestCore.create(tmp.newFolder());
        cap = new AppLauncherCapability();
        assertEquals("app-launcher", cap.name());
        core.add(cap);
        core.prepare(new JSONObject());
        platform = new FakePlatform();
        platform.installed.put("com.example.game", "com.example.game/com.example.game.Main");
        platform.installed.put("com.example.other", "com.example.other/com.example.other.Main");
        cap.usePlatformForTest(platform);
    }

    @After public void tearDown() {
        cap.stop();
        TestCore.releaseMainThread();
    }

    private JSONObject post(String body) throws Exception { return TestCore.call(core, "POST", "/launch", null, body); }

    @Test public void declaresItsSettingsRouteAndService() {
        assertEquals("nothing may be launched until a device says so", "", core.settings().get("launcher.allowed"));
        assertEquals(3000, core.settings().get("launcher.confirmMs"));
        assertTrue(core.router().routes().contains("POST /launch"));
        assertNotNull(core.services().find(AppLaunch.class));
    }

    @Test public void aMalformedRequestIsABadRequest() throws Exception {
        assertEquals(400, post("{}").getInt("_status"));
        assertEquals(400, post("{\"package\":\"x\"}").getInt("_status"));
        assertEquals(400, post("{\"intent\":\"intent:file:///sdcard/a.apk#Intent;end\"}").getInt("_status"));
        assertEquals("bad_request", core.services().find(AppLaunch.class).check(new JSONObject("{\"package\":\"x\"}")));
        assertTrue(order.isEmpty());
    }

    @Test public void withAnEmptyListNothingIsStarted() throws Exception {
        JSONObject r = post("{\"package\":\"com.example.game\"}");
        assertEquals(200, r.getInt("_status"));
        assertFalse(r.getBoolean("ok"));
        assertEquals("not_allowed", r.getString("error"));
        assertTrue("refused before lockdown is told and before any start", order.isEmpty());
    }

    @Test public void anAllowedPackageIsStartedAfterLockdownIsToldToLetItStay() throws Exception {
        core.settings().set("launcher.allowed", "com.example.game");
        core.services().provide(LockdownControl.class, new FakeLockdown());
        JSONObject r = post("{\"package\":\"com.example.game\"}");
        assertEquals(200, r.getInt("_status"));
        assertTrue(r.getBoolean("ok"));
        assertTrue(r.getBoolean("launched"));
        assertEquals("com.example.game/com.example.game.Main", r.getString("component"));
        // Under lock task the package must be on the list before the start, and the
        // watcher must not recall it in the second it takes to appear.
        assertEquals(java.util.Arrays.asList("allow com.example.game", "start com.example.game/com.example.game.Main"), order);
    }

    @Test public void whatIsNotInstalledSaysSo() throws Exception {
        core.settings().set("launcher.allowed", "com.example.missing");
        JSONObject r = post("{\"package\":\"com.example.missing\"}");
        assertFalse(r.getBoolean("ok"));
        assertEquals("not_installed", r.getString("error"));
        assertTrue(order.isEmpty());
    }

    @Test public void anIntentUriIsCheckedByWhatItResolvesToNotByWhatItSays() throws Exception {
        core.settings().set("launcher.allowed", "com.example.game");
        // The text names the allowed package; the system resolves it to another app.
        String uri = "intent:#Intent;action=android.intent.action.VIEW;package=com.example.game;end";
        platform.installed.put(uri, "com.example.other/com.example.other.Main");
        JSONObject r = post(new JSONObject().put("intent", uri).toString());
        assertEquals("not_allowed", r.getString("error"));
        assertTrue("never launched blindly", order.isEmpty());

        // An intent several apps could take resolves to the chooser.
        String open = "intent://example.test/#Intent;scheme=https;end";
        platform.installed.put(open, "android/com.android.internal.app.ResolverActivity");
        assertEquals("not_allowed", post(new JSONObject().put("intent", open).toString()).getString("error"));
        assertTrue(order.isEmpty());

        String good = "intent:#Intent;action=android.intent.action.MAIN;package=com.example.game;end";
        platform.installed.put(good, "com.example.game/com.example.game.Main");
        assertTrue(post(new JSONObject().put("intent", good).toString()).getBoolean("launched"));
    }

    @Test public void aPackageALeaseHasClosedIsNotStarted() throws Exception {
        core.settings().set("launcher.allowed", "com.example.game");
        core.services().provide(PackageGate.class, new PackageGate() {
            @Override public boolean ready() { return true; }
            @Override public boolean isHidden(String packageName) { return "com.example.game".equals(packageName); }
            @Override public boolean setHidden(String packageName, boolean hidden) { return true; }
        });
        assertEquals("not_allowed", post("{\"package\":\"com.example.game\"}").getString("error"));
        assertTrue(order.isEmpty());
    }

    @Test public void aStartTheSystemRefusedIsNotReportedAsLaunched() throws Exception {
        core.settings().set("launcher.allowed", "com.example.game");
        platform.refuseStart = true;
        JSONObject r = post("{\"package\":\"com.example.game\"}");
        assertFalse(r.getBoolean("ok"));
        assertEquals("start_refused", r.getString("error"));
        assertFalse(r.has("launched"));
    }

    @Test public void thePageBridgeGoesThroughTheSameChecks() throws Exception {
        // webview-host's daylight.launch() calls check() and then launch(): the same two the route uses.
        AppLaunch launcher = core.services().find(AppLaunch.class);
        assertEquals("not_allowed", launcher.check(new JSONObject("{\"package\":\"com.example.game\"}")));
        assertEquals("not_installed", launcher.check(new JSONObject("{\"package\":\"com.example.missing\"}")));
        assertEquals("bad_request", launcher.check(new JSONObject("{\"intent\":\"intent:content://a/b#Intent;end\"}")));
        assertEquals("not_allowed", launcher.launch(new JSONObject("{\"package\":\"com.example.game\"}")).getString("error"));
        assertTrue(order.isEmpty());
        core.settings().set("launcher.allowed", "com.example.game");
        assertNull(launcher.check(new JSONObject("{\"package\":\"com.example.game\"}")));
        assertTrue("a check starts nothing", order.isEmpty());
    }

    @Test public void theLaunchRouteNeedsTheToken() {
        core.settings().set("launcher.allowed", "com.example.game");
        assertEquals(401, core.router().dispatch("POST", "/launch", "wrong", Collections.emptyMap(), "{\"package\":\"com.example.game\"}").status);
        assertTrue(order.isEmpty());
        assertEquals(200, core.router().dispatch("POST", "/launch", FakeShell.TOKEN, Collections.emptyMap(), "{\"package\":\"com.example.game\"}").status);
    }

    @Test public void aLaunchIsConfirmedWhenTheForegroundCanBeSeen() throws Exception {
        core.settings().set("launcher.allowed", "com.example.game");
        core.settings().set("launcher.confirmMs", 200);
        FakeLockdown lockdown = new FakeLockdown();
        core.services().provide(LockdownControl.class, lockdown);
        cap.useObserverForTest(() -> true);       // a bound accessibility service
        JSONObject unseen = post("{\"package\":\"com.example.game\"}");
        assertFalse("started and never seen in front: not ok", unseen.getBoolean("ok"));
        assertEquals("launch_not_observed", unseen.getString("error"));
        lockdown.front = "com.example.game";
        JSONObject seen = post("{\"package\":\"com.example.game\"}");
        assertTrue(seen.getBoolean("ok"));
        assertTrue(seen.getBoolean("observedInFront"));
    }

    @Test public void aRealStartOverAnEmptyContextRefusesEverythingAndStopsTwice() throws Exception {
        cap.stop();
        File dir = tmp.newFolder();
        core = TestCore.createWithContext(dir, new FakeContext(dir));
        cap = new AppLauncherCapability();
        core.add(cap);
        core.prepare(new JSONObject());
        core.settings().set("launcher.allowed", "com.example.game");
        cap.start();
        // The fake context has no package manager: nothing resolves, so nothing is started.
        assertEquals("not_installed", post("{\"package\":\"com.example.game\"}").getString("error"));
        cap.stop();
        assertEquals("not_installed", post("{\"package\":\"com.example.game\"}").getString("error"));
        cap.stop();
    }
}
