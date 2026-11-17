package net.kckern.daylight.cap.quickinput;

import static org.junit.Assert.*;

import net.kckern.daylight.api.PayloadPort;
import net.kckern.daylight.core.CoreRuntime;
import net.kckern.daylight.core.backend.Backend;
import net.kckern.daylight.core.backend.Http;
import net.kckern.daylight.core.spi.LinkHandler;
import net.kckern.daylight.core.spi.LocalNotices;
import net.kckern.daylight.core.testing.FakeContext;
import net.kckern.daylight.core.testing.TestCore;

import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

public class QuickInputCapabilityTest {
    private static final Map<String, String> NO_QUERY = Collections.emptyMap();

    @Rule public TemporaryFolder tmp = new TemporaryFolder();
    private CoreRuntime core;
    private QuickInputCapability cap;
    private File inbox;
    private volatile boolean down;
    private volatile int status = 200;
    /** The body the backend answers with; null for the usual one of the status. */
    private volatile String answer;
    private volatile boolean linkUp = true;
    private long now = 10_000;
    private int recordScreens;
    /** Every capture screen asked for: "voice journal Journal". */
    private final List<String> opened = new ArrayList<>();
    private boolean screensBroken;
    private final QuickInputCapability.Screens screens = new QuickInputCapability.Screens() {
        @Override public void record(String dest, String label) { open("voice", dest, label); recordScreens++; }
        @Override public void text(String dest, String label) { open("text", dest, label); }
        @Override public void photo(String dest, String label) { open("photo", dest, label); }
        private void open(String kind, String dest, String label) {
            if (screensBroken) throw new android.content.ActivityNotFoundException();
            opened.add(kind + " " + dest + " " + label);
        }
    };
    private static final QuickInputCapability.Screens NO_SCREENS = new QuickInputCapability.Screens() {
        @Override public void record(String dest, String label) { }
        @Override public void text(String dest, String label) { }
        @Override public void photo(String dest, String label) { }
    };
    private final List<String> notices = new ArrayList<>();
    private final List<String> uploads = Collections.synchronizedList(new ArrayList<String>());
    private final List<String> urls = Collections.synchronizedList(new ArrayList<String>());
    private final List<String> types = Collections.synchronizedList(new ArrayList<String>());

    private final Http http = new Http() {
        @Override public Reply get(String url) { throw new AssertionError(); }
        @Override public Reply postJson(String url, String json) { throw new AssertionError(); }
        @Override public Reply postFile(String url, String contentType, File file, Map<String, String> headers) throws IOException {
            if (down) throw new IOException("no route to host");
            uploads.add(headers.get("X-Daylight-Input-Id"));
            urls.add(url);
            types.add(contentType);
            if (answer != null) return new Reply(status, answer);
            return new Reply(status, status == 200 ? "{\"ok\":true,\"duplicate\":false}" : "{\"ok\":false,\"error\":\"processing_failed\"}");
        }
    };

    @Before public void setUp() throws Exception {
        core = TestCore.create(tmp.newFolder());
        inbox = tmp.newFolder("inbox");
        cap = new QuickInputCapability(http, new File(tmp.newFolder(), "state"), inbox, () -> now, () -> linkUp, screens);
        core.add(cap);
        core.prepare(new JSONObject());
        core.settings().set(Backend.BASE_URL, "https://kiosk.example");
        core.settings().set(Backend.USER, "example-user");
        core.services().provide(LocalNotices.class, new LocalNotices() {
            @Override public void post(String id, String channel, String title, String text, String linkUri) {
                notices.add(id + " " + channel + " " + title + ": " + text + " " + linkUri);
            }
            @Override public void cancel(String id) { notices.add("cancel " + id); }
        });
    }

    @After public void tearDown() { cap.stop(); TestCore.releaseMainThread(); }

    private File record(String id) throws Exception {
        File f = new File(inbox, id + ".m4a");
        Files.write(f.toPath(), new byte[32]);
        return f;
    }

    private LinkHandler inputLink() {
        for (LinkHandler h : core.services().all(LinkHandler.class)) if ("input".equals(h.kind())) return h;
        throw new AssertionError("no input link handler");
    }

    private static Map<String, String> to(String dest) { return Collections.singletonMap("to", dest); }

    private LinkHandler memoLink() {
        for (LinkHandler h : core.services().all(LinkHandler.class)) if ("memo".equals(h.kind())) return h;
        throw new AssertionError("no memo link handler");
    }

    @Test public void aRecordingIsUploadedAndItsFileRemoved() throws Exception {
        File memo = record("1700000000000-ab12cd34");
        assertEquals(1, TestCore.call(core, "POST", "/input/recorded", null, "{}").getInt("waiting"));
        cap.pumpOnce();
        assertFalse(memo.exists());
        JSONObject queue = TestCore.get(core, "/input/queue");
        assertEquals(1, queue.getInt("uploaded"));
        assertEquals(0, queue.getInt("waiting"));
        assertEquals(Collections.singletonList("1700000000000-ab12cd34"), uploads);
        assertTrue("nothing waiting, nothing to say", notices.isEmpty());
    }

    @Test public void withTheLinkDownTheMemoWaitsAndTheOwnerIsToldOnce() throws Exception {
        down = true;
        record("1700000000000-ab12cd34");
        cap.pumpOnce();
        assertEquals(1, TestCore.get(core, "/input/queue").getInt("waiting"));
        assertEquals("input-queue uploads Quick inputs: 1 input waiting to upload (Journal 1) daylight://input/queue", notices.get(0));
        cap.pumpOnce();
        assertEquals("an unchanged state is not announced again", 1, notices.size());

        down = false;
        assertEquals(200, TestCore.call(core, "POST", "/input/retry", null, "{}").getInt("_status"));
        cap.pumpOnce();
        assertEquals(0, TestCore.get(core, "/input/queue").getInt("waiting"));
        assertEquals("cancel input-queue", notices.get(1));
    }

    @Test public void withNoNetworkNothingIsSentAndTheMemoWaits() throws Exception {
        linkUp = false;
        record("1700000000000-ab12cd34");
        cap.pumpOnce();
        assertTrue(uploads.isEmpty());
        assertEquals("1 input waiting to upload (Journal 1)", notices.get(0).replaceAll(".*: (.*) daylight.*", "$1"));
    }

    @Test public void aMemoTheBackendKeepsFailingIsParkedAndSaidSo() throws Exception {
        status = 500;
        File memo = record("1700000000000-ab12cd34");
        for (int i = 0; i < 20; i++) {
            cap.pumpOnce();
            now += 3_700_000;
        }
        JSONObject queue = TestCore.get(core, "/input/queue");
        assertEquals(1, queue.getInt("parked"));
        assertEquals(20, uploads.size());
        assertTrue("the audio is kept", memo.exists());
        assertTrue(notices.get(notices.size() - 1).contains("1 input could not be sent (Journal 1). Tap to try again."));

        // A tap on that notice is the keyed link daylight://memo/queue.
        status = 200;
        JSONObject r = memoLink().handle("queue", NO_QUERY);
        assertEquals("toast", r.getString("effect"));
        assertEquals("Trying again: 1 input", r.getString("message"));
        cap.pumpOnce();
        assertFalse(memo.exists());
        assertEquals("cancel input-queue", notices.get(notices.size() - 1));
    }

    @Test public void withNoIdentityNothingIsRecordedNothingIsSentAndItIsSaid() throws Exception {
        core.settings().set(Backend.USER, "");
        JSONObject r = memoLink().handle("new", NO_QUERY);
        assertEquals("toast", r.getString("effect"));
        assertEquals("Quick inputs are not set up on this phone: identity not configured", r.getString("message"));
        assertEquals("the recorder is not opened", 0, recordScreens);

        // A recording made before the identity was lost is kept, not sent, and not retried in a loop.
        File memo = record("1700000000000-ab12cd34");
        cap.pumpOnce();
        cap.pumpOnce();
        assertTrue(uploads.isEmpty());
        assertTrue(memo.exists());
        assertEquals(1, notices.size());
        assertEquals("input-queue uploads Quick inputs are not set up: identity not configured. 1 input is kept on this phone (Journal 1). daylight://input/queue",
                notices.get(0));
        JSONObject queue = TestCore.get(core, "/input/queue");
        assertEquals("identity not configured", queue.getString("blocked"));
        assertEquals("identity.user is not set: quick inputs cannot be sent", queue.getJSONArray("problems").getString(0));
        assertEquals("with nothing to send, the queue is not looked at again until something changes", -1, cap.nextWakeAtMs());
    }

    @Test public void theMemoLinkOpensTheRecorderAndNothingElse() throws Exception {
        JSONObject r = memoLink().handle("new", Collections.singletonMap("anything", "else"));
        assertTrue(r.getBoolean("ok"));
        assertEquals("none", r.getString("effect"));
        assertEquals(1, recordScreens);
        for (String bad : new String[] { "erase", "", "new/extra", "NEW" }) {
            try { memoLink().handle(bad, NO_QUERY); fail("accepted " + bad); } catch (IllegalArgumentException expected) { }
        }
        assertEquals(1, recordScreens);
    }

    @Test public void theQueueLinkSaysWhatIsThere() throws Exception {
        assertEquals("No inputs are waiting", memoLink().handle("queue", NO_QUERY).getString("message"));
    }

    @Test public void theRecorderTellsThePayloadOverThePort() throws Exception {
        PayloadPort port = PayloadPort.named(QuickInputCapability.PORT);
        assertFalse(port.ready());
        CoreRuntime real = TestCore.createWithContext(tmp.newFolder(), new FakeContext(tmp.newFolder()));
        QuickInputCapability started = new QuickInputCapability(http, null, null, System::currentTimeMillis, () -> true, NO_SCREENS);
        real.add(started);
        real.prepare(new JSONObject());
        real.settings().set(Backend.BASE_URL, "https://kiosk.example");
        real.settings().set(Backend.USER, "example-user");
        assertEquals(0, FakeContext.liveThreads(QuickInputCapability.WORKER));
        started.start();
        try {
            assertTrue(port.ready());
            assertEquals(1, FakeContext.liveThreads(QuickInputCapability.WORKER));
            File recorded = new File(started.inbox(), "1700000000000-ab12cd34.m4a");
            Files.write(recorded.toPath(), new byte[32]);
            JSONObject answer = new JSONObject(port.call("{\"op\":\"recorded\"}", 0));
            assertTrue(answer.getBoolean("ok"));
            long deadline = System.currentTimeMillis() + 5000;
            while (recorded.exists() && System.currentTimeMillis() < deadline) Thread.sleep(10);
            assertFalse("the upload thread took it", recorded.exists());
            assertFalse(new JSONObject(port.call("{\"op\":\"erase\"}", 0)).getBoolean("ok"));
            assertFalse(new JSONObject(port.call("not json", 0)).getBoolean("ok"));
        } finally {
            started.stop();
        }
        assertFalse(port.ready());
        long deadline = System.currentTimeMillis() + 5000;
        while (FakeContext.liveThreads(QuickInputCapability.WORKER) > 0 && System.currentTimeMillis() < deadline) Thread.sleep(10);
        assertEquals(0, FakeContext.liveThreads(QuickInputCapability.WORKER));
        started.stop();
    }

    @Test public void withNoAndroidContextNothingStartsAndTheStatusStillAnswers() throws Exception {
        CoreRuntime bare = TestCore.create(tmp.newFolder());
        QuickInputCapability plain = new QuickInputCapability();
        bare.add(plain);
        bare.prepare(new JSONObject());
        plain.start();
        assertEquals(0, FakeContext.liveThreads(QuickInputCapability.WORKER));
        JSONObject queue = TestCore.get(bare, "/input/queue");
        assertEquals(200, queue.getInt("_status"));
        assertEquals(0, queue.getInt("waiting"));
        assertEquals("with no identity and no site, both are problems", 2, queue.getJSONArray("problems").length());
        LinkHandler link = null;
        for (LinkHandler h : bare.services().all(LinkHandler.class)) if ("memo".equals(h.kind())) link = h;
        assertEquals("toast", link.handle("new", NO_QUERY).getString("effect"));
        plain.stop();
    }

    @Test public void nothingSaidOrRecordedIsInTheShellLog() throws Exception {
        record("1700000000000-ab12cd34");
        cap.pumpOnce();
        net.kckern.daylight.core.testing.FakeShell shell = (net.kckern.daylight.core.testing.FakeShell) core.shell();
        assertEquals(1, shell.notes.size());
        assertEquals("INPUT uploaded 1700000000000-ab12cd34 voice journal 32 bytes", shell.notes.get(0));
    }

    // ── the intake's device binding and daily allowance ──────────────────────

    @Test public void aPhoneTheBackendDoesNotAllowYetIsToldOnceAndTheNoticeGoesWithTheFirstSuccess() throws Exception {
        status = 403;
        answer = "{\"ok\":false,\"error\":\"device_not_allowed\"}";
        File memo = record("1700000000000-ab12cd34");
        for (int i = 0; i < 30; i++) {
            cap.pumpOnce();
            now += 3_700_000;
        }
        JSONObject queue = TestCore.get(core, "/input/queue");
        assertEquals("thirty refusals later it is still waiting, not parked", 1, queue.getInt("waiting"));
        assertEquals(0, queue.getInt("parked"));
        assertEquals("[\"journal\"]", queue.getJSONArray("notAllowed").toString());
        assertTrue(memo.exists());
        assertEquals("said once", 1, notices.size());
        assertTrue(notices.get(0), notices.get(0).contains("This phone is not allowed to send to Journal yet."));

        status = 200;
        answer = null;
        cap.pumpOnce();
        assertFalse(memo.exists());
        assertEquals("cancel input-queue", notices.get(notices.size() - 1));
        assertEquals(0, TestCore.get(core, "/input/queue").getJSONArray("notAllowed").length());
    }

    @Test public void theDailyAllowanceStopsSendingUntilTheBackendsTimeAndSaysWhen() throws Exception {
        status = 429;
        answer = "{\"ok\":false,\"error\":\"daily_limit\",\"limit\":\"memos\",\"retryAfterSeconds\":3600}";
        record("1700000000000-ab12cd34");
        record("1700000001000-ab12cd34");
        cap.pumpOnce();
        assertEquals(1, uploads.size());
        assertEquals(now + 3_600_000L, cap.nextWakeAtMs());
        assertTrue(notices.get(0), notices.get(0).contains("The daily allowance for Journal is used up. Sending resumes at about "
                + QueueNotice.clock(now + 3_600_000L)));
        // The owner taps the notice: nothing is sent early, and the answer says why.
        JSONObject r = memoLink().handle("queue", NO_QUERY);
        assertTrue(r.getString("message"), r.getString("message").startsWith("The daily allowance is used up."));
        now += 3_599_000;
        cap.pumpOnce();
        assertEquals("not before the time the backend named", 1, uploads.size());
        status = 200;
        answer = null;
        now += 1_000;
        cap.pumpOnce();
        assertEquals(3, uploads.size());
        assertEquals(0, TestCore.get(core, "/input/queue").getInt("waiting"));
    }

    @Test public void withADeviceIdentityTheIntakeCannotBindNothingIsRecordedOrSent() throws Exception {
        core.settings().set(Backend.DEVICE, "browser:example-tablet");
        JSONObject r = memoLink().handle("new", NO_QUERY);
        assertEquals("Quick inputs are not set up on this phone: device identity not configured", r.getString("message"));
        assertEquals(0, recordScreens);
        record("1700000000000-ab12cd34");
        cap.pumpOnce();
        assertTrue(uploads.isEmpty());
        assertTrue(notices.get(0), notices.get(0).contains("device identity not configured. 1 input is kept on this phone (Journal 1)."));
        assertEquals("device identity not configured", TestCore.get(core, "/input/queue").getString("blocked"));
    }

    // ── a recording that was cut off ─────────────────────────────────────────

    @Test public void whatTheRecorderRecoversIsQueuedWithItsStartTimeAndWhatItCannotIsSaidOnce() throws Exception {
        final File cutOff = new File(inbox.getParentFile(), "cutoff");
        cap.recovery = () -> {
            // The installed recorder's part: a playable Ogg becomes a finished file, an MP4 without its index is set aside.
            try {
                Files.write(new File(inbox, "1700000000000-ab12cd34.ogg").toPath(), new byte[5000]);
                cutOff.mkdirs();
                Files.write(new File(cutOff, "1690000000000-ab12cd34-03.m4a").toPath(), new byte[5000]);
            } catch (IOException e) { throw new IllegalStateException(e); }
            return new int[] { 1, 1 };
        };
        cap.pumpOnce();
        assertEquals("the recovered memo was sent", Collections.singletonList("1700000000000-ab12cd34"), uploads);
        assertEquals(1, TestCore.get(core, "/input/queue").getInt("cutOffKept"));
        assertEquals(1, notices.size());
        assertEquals("memo-cutoff uploads Voice memos: 1 recording was cut off and cannot be played. It is kept on this phone and not sent. ",
                notices.get(0));
        assertTrue("never deleted", new File(cutOff, "1690000000000-ab12cd34-03.m4a").isFile());
        cap.recovery = () -> new int[] { 0, 0 };
        cap.pumpOnce();
        assertEquals("said once", 1, notices.size());
    }

    @Test public void anInstalledShellWithoutRecoveryLosesNothingAndStopsNothing() throws Exception {
        cap.recovery = () -> { throw new NoClassDefFoundError("MemoRecovery"); };
        File part = new File(inbox, "1700000000000-ab12cd34.ogg.part");
        Files.write(part.toPath(), new byte[5000]);
        record("1700000001000-ab12cd34");
        cap.pumpOnce();
        cap.pumpOnce();
        assertTrue(part.exists());
        assertEquals(1, uploads.size());
    }

    // ── discarding what could not be sent ────────────────────────────────────

    @Test public void discardingParkedMemosIsAskedTwiceAndLeavesWaitingOnesAlone() throws Exception {
        status = 422;
        answer = "{\"ok\":false,\"error\":\"empty_transcription\"}";
        File refused = record("1700000000000-ab12cd34");
        cap.pumpOnce();
        assertEquals(1, TestCore.get(core, "/input/queue").getInt("parked"));
        assertTrue("the notice carries the action", notices.get(notices.size() - 1).contains("could not be sent"));
        down = true;
        File waiting = record("1700000005000-ab12cd34");
        cap.pumpOnce();

        JSONObject first = memoLink().handle("discard", NO_QUERY);
        assertEquals("Tap Discard again to delete 1 input that could not be sent. This cannot be undone.", first.getString("message"));
        assertTrue("nothing is deleted by the first tap", refused.exists());
        now += QuickInputCapability.DISCARD_CONFIRM_MS + 1;
        assertTrue("too late: it asks again", memoLink().handle("discard", NO_QUERY).getString("message").startsWith("Tap Discard again"));
        assertTrue(refused.exists());
        now += 2_000;
        assertEquals("Discarded 1 input", memoLink().handle("discard", NO_QUERY).getString("message"));
        assertFalse(refused.exists());
        assertTrue("a memo that is only waiting is kept", waiting.exists());
        JSONObject queue = TestCore.get(core, "/input/queue");
        assertEquals(0, queue.getInt("parked"));
        assertEquals(1, queue.getInt("waiting"));
        assertEquals("No inputs to discard", memoLink().handle("discard", NO_QUERY).getString("message"));
    }
    // ── destinations ─────────────────────────────────────────────────────────

    @Test public void theDestinationsAreSettingsWithTheContractsDefaults() throws Exception {
        for (int i = 0; i < Destinations.DEFAULTS.length; i++) {
            assertEquals(Destinations.DEFAULTS[i], core.settings().get("input.dest." + (i + 1)));
        }
        assertEquals("", core.settings().get("input.dest." + Destinations.SLOTS));
        org.json.JSONArray listed = TestCore.get(core, "/input/queue").getJSONArray("destinations");
        assertEquals(5, listed.length());
        assertEquals("journal", listed.getJSONObject(0).getString("id"));
        assertEquals("voice", listed.getJSONObject(0).getString("kind"));
        assertEquals("Journal", listed.getJSONObject(0).getString("label"));
    }

    @Test public void aMalformedDestinationIsRefusedWhenItIsSet() throws Exception {
        for (String bad : new String[] { "walk|Walk|voice|https://elsewhere.example/api/v1/x", "walk|Walk|voice|/feed",
                "walk|Walk|video|/api/v1/x", "walk|Walk|voice|/api/v1/x?user=other" }) {
            try {
                core.settings().set("input.dest.6", bad);
                fail("accepted " + bad);
            } catch (net.kckern.daylight.core.SettingsRegistry.InvalidSettingException expected) {
                assertFalse("the value is not repeated", expected.getMessage().contains("elsewhere"));
            }
        }
        assertEquals("", core.settings().get("input.dest.6"));
        core.settings().set("input.dest.6", "walk|Walk|text|/api/v1/example/text");
        assertEquals(6, TestCore.get(core, "/input/queue").getJSONArray("destinations").length());
    }

    @Test public void aDestinationIdUsedTwiceIsAProblemAndNeverStopsAStart() throws Exception {
        core.settings().set("input.dest.6", "journal|Second journal|text|/api/v1/journalist/text");
        JSONObject queue = TestCore.get(core, "/input/queue");
        assertEquals("input.dest.6: id 'journal' is used twice", queue.getJSONArray("problems").getString(0));
        assertEquals("the first line of that id stands", 5, queue.getJSONArray("destinations").length());
        cap.start();
        cap.stop();
    }
    // ── one queue for every kind and destination ─────────────────────────────

    private File input(String name, int bytes) throws Exception {
        File f = new File(cap.inputsInbox, name);
        Files.write(f.toPath(), new byte[bytes]);
        return f;
    }

    @Test public void textAndAPhotoGoThroughTheSameQueueToTheirOwnRoutes() throws Exception {
        TestCore.get(core, "/input/queue");                 // makes the inboxes
        File note = input("1700000000000-ab12cd34.meal-note.txt", 12);
        File photo = input("1700000001000-ab12cd34.meal-photo.jpg", 300);
        File memo = new File(inbox, "1700000002000-ab12cd34.meal.ogg");
        Files.write(memo.toPath(), new byte[40]);
        assertEquals(3, TestCore.call(core, "POST", "/input/recorded", null, "{}").getInt("waiting"));
        cap.pumpOnce();
        assertFalse(note.exists() || photo.exists() || memo.exists());
        assertEquals(java.util.Arrays.asList("https://kiosk.example/api/v1/nutribot/text?user=example-user",
                "https://kiosk.example/api/v1/nutribot/photo?user=example-user",
                "https://kiosk.example/api/v1/nutribot/voice?user=example-user"), urls);
        assertEquals(java.util.Arrays.asList("text/plain; charset=utf-8", "image/jpeg", "audio/ogg"), types);
        net.kckern.daylight.core.testing.FakeShell shell = (net.kckern.daylight.core.testing.FakeShell) core.shell();
        assertEquals("ids, kinds, destinations and sizes, and nothing of what was typed or photographed",
                java.util.Arrays.asList("INPUT uploaded 1700000000000-ab12cd34 text meal-note 12 bytes",
                        "INPUT uploaded 1700000001000-ab12cd34 photo meal-photo 300 bytes",
                        "INPUT uploaded 1700000002000-ab12cd34 voice meal 40 bytes"), shell.notes);
    }

    @Test public void aDailyLimitOnOneDestinationDoesNotHoldTheOthersAndTheNoticeNamesIt() throws Exception {
        TestCore.get(core, "/input/queue");
        record("1700000000000-ab12cd34");                      // the journal's
        input("1700000001000-ab12cd34.meal-photo.jpg", 300);
        status = 429;
        answer = "{\"ok\":false,\"error\":\"daily_limit\",\"limit\":60,\"retryAfterSeconds\":3600}";
        cap.pumpOnce();
        assertEquals("each destination was asked once and each is held on its own", 2, uploads.size());
        String said = notices.get(notices.size() - 1);
        assertTrue(said, said.contains("The daily allowance for Journal is used up."));
        assertTrue(said, said.contains("The daily allowance for Meal photo is used up."));
        // Only the journal's allowance comes back.
        JSONObject held = TestCore.get(core, "/input/queue").getJSONObject("holds");
        assertEquals(now + 3_600_000L, held.getLong("journal"));
        assertEquals(now + 3_600_000L, held.getLong("meal-photo"));
        status = 200;
        answer = null;
        now += 3_600_000L;
        cap.pumpOnce();
        assertEquals(0, TestCore.get(core, "/input/queue").getInt("waiting"));
    }

    @Test public void aDestinationThatWasRemovedParksItsInputsAndSaysSoByItsId() throws Exception {
        TestCore.get(core, "/input/queue");
        File photo = input("1700000001000-ab12cd34.meal-photo.jpg", 300);
        core.settings().set("input.dest.5", "");
        cap.pumpOnce();
        assertTrue(uploads.isEmpty());
        assertTrue("kept until it is sent or discarded", photo.exists());
        JSONObject entry = TestCore.get(core, "/input/queue").getJSONArray("inputs").getJSONObject(0);
        assertEquals("PARKED", entry.getString("state"));
        assertEquals("unknown destination", entry.getString("lastError"));
        assertTrue(notices.get(0), notices.get(0).contains("1 input could not be sent (meal-photo 1). Tap to try again."));
    }

    @Test public void theQueueOfTheBuildBeforeDestinationsIsCarriedOver() throws Exception {
        File stateDir = new File(tmp.newFolder(), "state");
        stateDir.mkdirs();
        File kept = record("1600000000000-ab12cd34");
        Files.write(new File(stateDir, QuickInputCapability.OLD_STATE_FILE).toPath(), ("{\"uploaded\":7,\"memos\":[{\"id\":\"1600000000000-ab12cd34\","
                + "\"file\":\"" + kept.getPath().replace("\\", "\\\\") + "\",\"recordedAtMs\":1600000000000,\"state\":\"PARKED\",\"attempts\":20}]}")
                .getBytes(java.nio.charset.StandardCharsets.UTF_8));
        CoreRuntime other = TestCore.create(tmp.newFolder());
        QuickInputCapability carried = new QuickInputCapability(http, stateDir, inbox, () -> now, () -> linkUp, NO_SCREENS);
        other.add(carried);
        other.prepare(new JSONObject());
        JSONObject queue = TestCore.get(other, "/input/queue");
        assertEquals(7, queue.getInt("uploaded"));
        assertEquals(1, queue.getInt("parked"));
        assertEquals("journal", queue.getJSONArray("inputs").getJSONObject(0).getString("dest"));
        assertTrue(new File(stateDir, QuickInputCapability.STATE_FILE).isFile());
        assertFalse(new File(stateDir, QuickInputCapability.OLD_STATE_FILE).exists());
        carried.stop();
    }
    // ── links: what starts a capture ─────────────────────────────────────────

    @Test public void anInputLinkOpensTheScreenOfItsKindForItsDestination() throws Exception {
        assertEquals("none", inputLink().handle("voice", to("meal")).getString("effect"));
        assertEquals("none", inputLink().handle("text", to("journal-note")).getString("effect"));
        assertEquals("none", inputLink().handle("photo", to("meal-photo")).getString("effect"));
        assertEquals(java.util.Arrays.asList("voice meal Meal", "text journal-note Journal note", "photo meal-photo Meal photo"), opened);
    }

    @Test public void theMemoLinkIsAVoiceInputForTheJournal() throws Exception {
        memoLink().handle("new", NO_QUERY);
        inputLink().handle("voice", to("journal"));
        assertEquals(java.util.Arrays.asList("voice journal Journal", "voice journal Journal"), opened);
    }

    @Test public void anInputLinkForADestinationThatDoesNotExistOrDoesNotTakeItsKindOpensNothing() throws Exception {
        String[][] bad = { { "voice", "walk" }, { "text", "journal" }, { "photo", "meal" }, { "voice", "meal-photo" }, { "voice", "" },
                { "video", "journal" }, { "", "journal" }, { "voice/extra", "journal" }, { "VOICE", "journal" },
                { "voice", "/api/v1/journalist/voice" }, { "voice", "https://elsewhere.example/api/v1/x" } };
        for (String[] row : bad) {
            try { inputLink().handle(row[0], to(row[1])); fail("accepted " + row[0] + " to " + row[1]); }
            catch (IllegalArgumentException expected) { }
        }
        try { inputLink().handle("voice", NO_QUERY); fail("accepted a link with no destination"); } catch (IllegalArgumentException expected) { }
        assertTrue(opened.isEmpty());
    }

    /**
     * The link activity is exported, so a web page or another app can send any link. The
     * notifications capability refuses an input or memo link without this install's key
     * before it reaches here; this is the second lock on the same door.
     */
    @Test public void aLinkThatDidNotCarryTheInstallKeyStartsNoCaptureEvenIfItGotThisFar() throws Exception {
        for (String kind : new String[] { "voice", "text", "photo" }) {
            JSONObject r = inputLink().handle(kind, to(kind.equals("voice") ? "journal" : kind.equals("text") ? "journal-note" : "meal-photo"), false);
            assertFalse(r.getBoolean("ok"));
            assertEquals("forbidden", r.getString("error"));
        }
        assertFalse(memoLink().handle("new", NO_QUERY, false).getBoolean("ok"));
        assertFalse(inputLink().handle("discard", NO_QUERY, false).getBoolean("ok"));
        assertTrue("no recorder, no text screen, no camera", opened.isEmpty());
        assertEquals("none", inputLink().handle("photo", to("meal-photo"), true).getString("effect"));
        assertEquals(1, opened.size());
    }

    @Test public void withNoIdentityNoCaptureScreenOpensForAnyKind() throws Exception {
        core.settings().set(Backend.USER, "");
        for (String[] row : new String[][] { { "voice", "meal" }, { "text", "meal-note" }, { "photo", "meal-photo" } }) {
            JSONObject r = inputLink().handle(row[0], to(row[1]));
            assertEquals("Quick inputs are not set up on this phone: identity not configured", r.getString("message"));
        }
        assertTrue(opened.isEmpty());
    }

    /** An installed app from before a screen existed: the tap says so and nothing else happens. */
    @Test public void aScreenTheInstalledAppDoesNotHaveIsSaidAndNothingBreaks() throws Exception {
        screensBroken = true;
        JSONObject r = inputLink().handle("photo", to("meal-photo"));
        assertEquals("toast", r.getString("effect"));
        assertEquals("Meal photo: not available in the installed app", r.getString("message"));
    }

    @Test public void theQueueAndDiscardLinksAreTheSameUnderEitherName() throws Exception {
        assertEquals("No inputs are waiting", inputLink().handle("queue", NO_QUERY).getString("message"));
        assertEquals("No inputs to discard", inputLink().handle("discard", NO_QUERY).getString("message"));
        assertEquals("No inputs to discard", memoLink().handle("discard", NO_QUERY).getString("message"));
        try { inputLink().handle("erase", NO_QUERY); fail("accepted input/erase"); } catch (IllegalArgumentException expected) { }
    }
}
