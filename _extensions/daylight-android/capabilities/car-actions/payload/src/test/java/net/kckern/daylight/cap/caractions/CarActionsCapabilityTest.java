package net.kckern.daylight.cap.caractions;

import static org.junit.Assert.*;

import net.kckern.daylight.api.PayloadPort;
import net.kckern.daylight.core.CoreRuntime;
import net.kckern.daylight.core.LinkEffect;
import net.kckern.daylight.core.spi.ActionList;
import net.kckern.daylight.core.testing.FakeContext;
import net.kckern.daylight.core.testing.TestCore;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class CarActionsCapabilityTest {
    private static final String CERT = "ab".repeat(32);

    @Rule public TemporaryFolder tmp = new TemporaryFolder();
    private CoreRuntime core;
    private CarActionsCapability cap;
    private final List<String> ran = new ArrayList<>();
    private final List<String> pinsWritten = new ArrayList<>();
    private final Map<String, JSONObject> actions = new LinkedHashMap<>();

    /** One-tap actions as the car capability sees them: described by id, run by id. */
    private final ActionList list = new ActionList() {
        @Override public JSONArray actions() { return new JSONArray(); }
        @Override public JSONObject describe(String id) { return id == null ? null : actions.get(id); }
        @Override public JSONObject run(String id) throws Exception {
            if (!actions.containsKey(id)) throw new IllegalArgumentException("unknown action");
            ran.add(id);
            return "omw".equals(id) ? LinkEffect.toast("Location sharing is not built yet") : LinkEffect.toast("Lights off: done");
        }
    };

    private void action(String id, String label, String kind, String target) throws Exception {
        actions.put(id, new JSONObject().put("id", id).put("label", label).put("icon", "bolt").put("kind", kind).put("target", target));
    }

    @Before public void setUp() throws Exception {
        action("omw", "On my way", "location", "share");
        action("lights", "Lights off", "api", "/api/v1/home/scenes/all-off");
        action("media", "Media", "bookmark", "media");
        action("journal", "Journal", "input", "voice:journal");
        core = TestCore.create(tmp.newFolder());
        core.services().provide(ActionList.class, list);
        cap = new CarActionsCapability();
        cap.pinCache = pinsWritten::add;
        core.add(cap);
        core.prepare(new JSONObject());
    }

    @After public void tearDown() {
        cap.stop();
        TestCore.releaseMainThread();
    }

    private static String call(JSONObject request) throws Exception {
        return PayloadPort.named(CarActionsCapability.PORT).call(request.toString(), 0);
    }

    @Test public void theListIsEmptyUntilTheDeviceNamesActions() throws Exception {
        assertEquals("", core.settings().get(CarActionsCapability.ACTIONS));
        JSONObject status = TestCore.get(core, "/car/actions");
        assertEquals(200, status.getInt("_status"));
        assertEquals(0, status.getJSONArray("actions").length());
        assertEquals(0, status.getJSONArray("problems").length());
    }

    @Test public void theStatusListsWhatTheCarShowsAndWhatWasLeftOut() throws Exception {
        core.settings().set(CarActionsCapability.ACTIONS, "omw,lights,gone");
        JSONObject status = TestCore.get(core, "/car/actions");
        JSONArray shown = status.getJSONArray("actions");
        assertEquals(2, shown.length());
        assertEquals("omw", shown.getJSONObject(0).getString("id"));
        assertEquals("run", shown.getJSONObject(0).getString("kind"));
        assertEquals(1, status.getJSONArray("problems").length());
        assertTrue(status.getJSONArray("problems").getString(0).contains("no action 'gone'"));
    }

    @Test public void aWebPageActionIsRefusedWhenTheSettingIsWritten() {
        try {
            core.settings().set(CarActionsCapability.ACTIONS, "omw,media");
            fail("a web page was put on the car list");
        } catch (RuntimeException expected) {
            assertTrue(expected.getMessage(), expected.getMessage().contains("cannot be used in a car"));
        }
    }

    @Test public void thePortListsTheCarEntriesAndRunsOneByIdInProcess() throws Exception {
        core.settings().set(CarActionsCapability.ACTIONS, "omw,lights");
        cap.start();
        JSONObject listed = new JSONObject(call(new JSONObject().put("op", "list")));
        assertEquals(2, listed.getJSONArray("entries").length());
        assertEquals("On my way", listed.getJSONArray("entries").getJSONObject(0).getString("label"));
        JSONObject answer = new JSONObject(call(new JSONObject().put("op", "run").put("id", "omw")));
        assertEquals("Location sharing is not built yet", answer.getString("message"));
        assertEquals("[omw]", ran.toString());
    }

    /** Only what the car list shows can be run from the car: not any action of the phone. */
    @Test public void anActionThatIsNotOnTheCarListIsNotRun() throws Exception {
        core.settings().set(CarActionsCapability.ACTIONS, "omw");
        cap.start();
        for (String id : new String[] { "lights", "media", "nothing", "" }) {
            JSONObject answer = new JSONObject(call(new JSONObject().put("op", "run").put("id", id)));
            assertFalse(id, answer.getBoolean("ok"));
            assertEquals("That is not on the car list", answer.getString("message"));
        }
        assertTrue(ran.isEmpty());
        JSONObject unknown = new JSONObject(call(new JSONObject().put("op", "dance")));
        assertFalse(unknown.getBoolean("ok"));
    }

    /** A voice entry is recorded by the car screen itself: the port lists it and never runs it. */
    @Test public void aVoiceEntryIsListedWithItsDestinationAndIsNotRunThroughThePort() throws Exception {
        core.settings().set("identity.user", "example-user");
        core.settings().set(CarActionsCapability.ACTIONS, "journal,omw");
        cap.start();
        JSONObject journal = new JSONObject(call(new JSONObject().put("op", "list"))).getJSONArray("entries").getJSONObject(0);
        assertEquals("voice", journal.getString("kind"));
        assertEquals("journal", journal.getString("dest"));
        assertEquals("", journal.getString("why"));
        JSONObject answer = new JSONObject(call(new JSONObject().put("op", "run").put("id", "journal")));
        assertFalse(answer.getBoolean("ok"));
        assertTrue(ran.isEmpty());
    }

    @Test public void withNoUserAVoiceEntrySaysTheAppIsNotSetUp() throws Exception {
        core.settings().set(CarActionsCapability.ACTIONS, "journal");
        cap.start();
        JSONObject journal = new JSONObject(call(new JSONObject().put("op", "list"))).getJSONArray("entries").getJSONObject(0);
        assertEquals(CarActionsCapability.NOT_SET_UP, journal.getString("why"));
        assertEquals("Daylight is not set up for quick inputs", CarActionsCapability.NOT_SET_UP);
    }

    @Test public void theHostPinsAreHandedToTheInstalledServiceAtStartAndWhenTheyChange() throws Exception {
        cap.start();
        assertEquals("[{}]", pinsWritten.toString());
        core.settings().set(CarActionsCapability.HOST_PINS, CarActionsCapability.ANDROID_AUTO + "=" + CERT);
        assertEquals(2, pinsWritten.size());
        assertEquals(CERT, new JSONObject(pinsWritten.get(1)).getString(CarActionsCapability.ANDROID_AUTO));
    }

    /** The one host the car screen serves is Android Auto. Another package cannot be pinned. */
    @Test public void onlyAndroidAutoCanBePinnedAsTheHost() {
        assertEquals("com.google.android.projection.gearhead", CarActionsCapability.ANDROID_AUTO);
        for (String bad : new String[] { "com.example.other=" + CERT, CarActionsCapability.ANDROID_AUTO + "=nothex" }) {
            try { core.settings().set(CarActionsCapability.HOST_PINS, bad); fail("accepted " + bad); }
            catch (RuntimeException expected) { }
        }
    }

    @Test public void theCacheKeyIsTheOneTheInstalledServiceReads() {
        assertEquals("car.hostPins", CarActionsCapability.HOST_PINS);
        assertEquals("car", CarActionsCapability.PORT);
    }

    /** start() on a worker with no Looper, with an Android context; stop() twice. */
    @Test public void aRealStartAttachesThePortAndStopDetachesIt() throws Exception {
        CoreRuntime real = TestCore.createWithContext(tmp.newFolder(), new FakeContext(tmp.newFolder()));
        real.services().provide(ActionList.class, list);
        CarActionsCapability started = new CarActionsCapability();
        real.add(started);
        real.prepare(new JSONObject());
        PayloadPort port = PayloadPort.named(CarActionsCapability.PORT);
        assertFalse(port.ready());
        Thread worker = new Thread(started::start);
        worker.start();
        worker.join(20_000);
        try {
            assertTrue(port.ready());
        } finally {
            started.stop();
        }
        assertFalse(port.ready());
        started.stop();
    }

    @Test public void withNoAndroidContextStartAttachesNothing() {
        CarActionsCapability bare = new CarActionsCapability();
        CoreRuntime plain = TestCore.create(tmp.getRoot());
        plain.services().provide(ActionList.class, list);
        plain.add(bare);
        try {
            plain.prepare(new JSONObject());
            bare.start();
            assertFalse(PayloadPort.named(CarActionsCapability.PORT).ready());
        } catch (Exception e) {
            throw new AssertionError(e);
        } finally {
            bare.stop();
        }
    }

    @Test public void namesItself() {
        assertEquals("car-actions", cap.name());
    }
}
