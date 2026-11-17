package net.kckern.daylight.cap.widgets;

import static org.junit.Assert.*;

import net.kckern.daylight.core.CoreRuntime;
import net.kckern.daylight.core.spi.ActionList;
import net.kckern.daylight.core.testing.FakeContext;
import net.kckern.daylight.core.testing.FakeShell;
import net.kckern.daylight.core.testing.TestCore;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.util.Map;

public class WidgetsCapabilityTest {
    private static final String KEY = "kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk";

    @Rule public TemporaryFolder tmp = new TemporaryFolder();
    private CoreRuntime core;
    private WidgetsCapability cap;
    private Map<String, String> applied;
    private int applies;
    private RuntimeException sinkFailure;
    private volatile String label = "New memo";

    @Before public void setUp() throws Exception {
        core = TestCore.create(tmp.newFolder());
        cap = new WidgetsCapability(cache -> {
            if (sinkFailure != null) throw sinkFailure;
            applied = cache;
            applies++;
        });
        core.add(cap);
        core.prepare(new JSONObject());
    }

    @After public void tearDown() { cap.stop(); TestCore.releaseMainThread(); }

    private void withActions() {
        core.services().provide(ActionList.class, () -> {
            try {
                return new JSONArray().put(new JSONObject().put("id", "memo").put("label", label).put("icon", "mic")
                        .put("uri", "daylight://action/memo?k=" + KEY));
            } catch (Exception e) {
                throw new AssertionError(e);
            }
        });
    }

    @Test public void refreshWritesTheModelBuiltFromTheActionListAndAnswersWithoutTheKey() throws Exception {
        withActions();
        JSONObject r = TestCore.call(core, "POST", "/widgets/refresh", null, "{}");
        assertEquals(200, r.getInt("_status"));
        assertEquals("New memo", applied.get("widget.1.label"));
        assertEquals("daylight://action/memo?k=" + KEY, applied.get("widget.1.uri"));
        assertEquals("memo", r.getJSONArray("slots").getJSONObject(0).getString("id"));
        assertFalse(r.toString().contains(KEY));
    }

    @Test public void withoutTheActionsCapabilityTheWidgetIsEmpty() throws Exception {
        cap.start();
        assertEquals("", applied.get("widget.1.uri"));
        assertEquals(12, applied.size());
    }

    @Test public void theWidgetIsRedrawnWhenTheActionsArePublishedAgain() throws Exception {
        withActions();
        cap.start();
        assertEquals(1, applies);
        label = "Voice memo";
        core.events().publish(ActionList.PUBLISHED, new JSONObject());
        assertEquals(2, applies);
        assertEquals("Voice memo", applied.get("widget.1.label"));
        cap.stop();
        core.events().publish(ActionList.PUBLISHED, new JSONObject());
        assertEquals("a stopped capability no longer listens", 2, applies);
        cap.stop();
    }

    @Test public void anUnknownActionInTheListIsLeftOutAndReportedAndStartDoesNotThrow() throws Exception {
        withActions();
        core.settings().set("widgets.actions", "nope,memo");
        cap.start();
        assertEquals("New memo", applied.get("widget.1.label"));
        assertTrue(((FakeShell) core.shell()).notes.toString().contains("widgets.actions names unknown action 'nope'"));
        JSONObject listed = TestCore.get(core, "/widgets");
        assertEquals(1, listed.getJSONArray("problems").length());
        assertEquals("memo", listed.getJSONArray("slots").getJSONObject(0).getString("id"));
        assertFalse(listed.toString().contains(KEY));
    }

    @Test public void aListOfTheWrongShapeIsRefusedWhenItIsSet() {
        try { core.settings().set("widgets.actions", "a,b,c,d,e"); fail("accepted five"); }
        catch (RuntimeException expected) { assertTrue(expected.getMessage(), expected.getMessage().contains("at most 4")); }
    }

    @Test public void aLauncherThatMisbehavesDoesNotStopThePayload() throws Exception {
        sinkFailure = new IllegalStateException("no widget host");
        cap.start();
        assertTrue(((FakeShell) core.shell()).notes.toString().contains("could not refresh"));
        core.events().publish(ActionList.PUBLISHED, new JSONObject());   // must not throw either
    }

    @Test public void withoutAContextNothingIsWrittenAndRefreshSaysWhy() throws Exception {
        CoreRuntime bare = TestCore.create(tmp.newFolder());
        WidgetsCapability plain = new WidgetsCapability();
        bare.add(plain);
        bare.prepare(new JSONObject());
        plain.start();
        assertEquals(501, TestCore.call(bare, "POST", "/widgets/refresh", null, "{}").getInt("_status"));
        assertEquals(200, TestCore.get(bare, "/widgets").getInt("_status"));
        plain.stop();
    }

    @Test public void aRealStartOverADeviceWithNoWidgetHostSubscribesAndStopUnsubscribesTwice() throws Exception {
        FakeContext context = new FakeContext(tmp.newFolder());
        CoreRuntime real = TestCore.createWithContext(tmp.newFolder(), context);
        WidgetsCapability plain = new WidgetsCapability();
        real.add(plain);
        real.prepare(new JSONObject());
        int before = real.events().subscribers();
        plain.start();
        assertEquals(before + 1, real.events().subscribers());
        plain.stop();
        assertEquals(before, real.events().subscribers());
        plain.stop();
        assertEquals(before, real.events().subscribers());
        assertEquals(0, context.registered);
    }

    @Test public void namesItself() {
        assertEquals("widgets", cap.name());
    }
}
