package net.kckern.daylight.cap.voicememo;

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

public class VoiceMemoCapabilityTest {
    private static final Map<String, String> NO_QUERY = Collections.emptyMap();

    @Rule public TemporaryFolder tmp = new TemporaryFolder();
    private CoreRuntime core;
    private VoiceMemoCapability cap;
    private File inbox;
    private volatile boolean down;
    private volatile int status = 200;
    private volatile boolean linkUp = true;
    private long now = 10_000;
    private int recordScreens;
    private final List<String> notices = new ArrayList<>();
    private final List<String> uploads = Collections.synchronizedList(new ArrayList<String>());

    private final Http http = new Http() {
        @Override public Reply get(String url) { throw new AssertionError(); }
        @Override public Reply postJson(String url, String json) { throw new AssertionError(); }
        @Override public Reply postFile(String url, String contentType, File file, Map<String, String> headers) throws IOException {
            if (down) throw new IOException("no route to host");
            uploads.add(headers.get("X-Daylight-Memo-Id"));
            return new Reply(status, status == 200 ? "{\"ok\":true,\"duplicate\":false}" : "{\"error\":\"processing_failed\"}");
        }
    };

    @Before public void setUp() throws Exception {
        core = TestCore.create(tmp.newFolder());
        inbox = tmp.newFolder("inbox");
        cap = new VoiceMemoCapability(http, new File(tmp.newFolder(), "state"), inbox, () -> now, () -> linkUp, () -> recordScreens++);
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

    private LinkHandler memoLink() {
        for (LinkHandler h : core.services().all(LinkHandler.class)) if ("memo".equals(h.kind())) return h;
        throw new AssertionError("no memo link handler");
    }

    @Test public void aRecordingIsUploadedAndItsFileRemoved() throws Exception {
        File memo = record("1700000000000-ab12cd34");
        assertEquals(1, TestCore.call(core, "POST", "/memo/recorded", null, "{}").getInt("waiting"));
        cap.pumpOnce();
        assertFalse(memo.exists());
        JSONObject queue = TestCore.get(core, "/memo/queue");
        assertEquals(1, queue.getInt("uploaded"));
        assertEquals(0, queue.getInt("waiting"));
        assertEquals(Collections.singletonList("1700000000000-ab12cd34"), uploads);
        assertTrue("nothing waiting, nothing to say", notices.isEmpty());
    }

    @Test public void withTheLinkDownTheMemoWaitsAndTheOwnerIsToldOnce() throws Exception {
        down = true;
        record("1700000000000-ab12cd34");
        cap.pumpOnce();
        assertEquals(1, TestCore.get(core, "/memo/queue").getInt("waiting"));
        assertEquals("memo-queue uploads Voice memos: 1 voice memo waiting to upload daylight://memo/queue", notices.get(0));
        cap.pumpOnce();
        assertEquals("an unchanged state is not announced again", 1, notices.size());

        down = false;
        assertEquals(200, TestCore.call(core, "POST", "/memo/retry", null, "{}").getInt("_status"));
        cap.pumpOnce();
        assertEquals(0, TestCore.get(core, "/memo/queue").getInt("waiting"));
        assertEquals("cancel memo-queue", notices.get(1));
    }

    @Test public void withNoNetworkNothingIsSentAndTheMemoWaits() throws Exception {
        linkUp = false;
        record("1700000000000-ab12cd34");
        cap.pumpOnce();
        assertTrue(uploads.isEmpty());
        assertEquals("1 voice memo waiting to upload", notices.get(0).replaceAll(".*: (.*) daylight.*", "$1"));
    }

    @Test public void aMemoTheBackendKeepsFailingIsParkedAndSaidSo() throws Exception {
        status = 500;
        File memo = record("1700000000000-ab12cd34");
        for (int i = 0; i < 20; i++) {
            cap.pumpOnce();
            now += 3_700_000;
        }
        JSONObject queue = TestCore.get(core, "/memo/queue");
        assertEquals(1, queue.getInt("parked"));
        assertEquals(20, uploads.size());
        assertTrue("the audio is kept", memo.exists());
        assertTrue(notices.get(notices.size() - 1).contains("1 voice memo could not be sent. Tap to try again."));

        // A tap on that notice is the keyed link daylight://memo/queue.
        status = 200;
        JSONObject r = memoLink().handle("queue", NO_QUERY);
        assertEquals("toast", r.getString("effect"));
        assertEquals("Trying again: 1 voice memo", r.getString("message"));
        cap.pumpOnce();
        assertFalse(memo.exists());
        assertEquals("cancel memo-queue", notices.get(notices.size() - 1));
    }

    @Test public void withNoIdentityNothingIsRecordedNothingIsSentAndItIsSaid() throws Exception {
        core.settings().set(Backend.USER, "");
        JSONObject r = memoLink().handle("new", NO_QUERY);
        assertEquals("toast", r.getString("effect"));
        assertEquals("Voice memos are not set up on this phone: identity not configured", r.getString("message"));
        assertEquals("the recorder is not opened", 0, recordScreens);

        // A recording made before the identity was lost is kept, not sent, and not retried in a loop.
        File memo = record("1700000000000-ab12cd34");
        cap.pumpOnce();
        cap.pumpOnce();
        assertTrue(uploads.isEmpty());
        assertTrue(memo.exists());
        assertEquals(1, notices.size());
        assertEquals("memo-queue uploads Voice memos are not set up: identity not configured. 1 voice memo is kept on this phone. daylight://memo/queue",
                notices.get(0));
        JSONObject queue = TestCore.get(core, "/memo/queue");
        assertEquals("identity not configured", queue.getString("blocked"));
        assertEquals("identity.user is not set: voice memos cannot be sent", queue.getJSONArray("problems").getString(0));
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
        assertEquals("No voice memos are waiting", memoLink().handle("queue", NO_QUERY).getString("message"));
    }

    @Test public void theRecorderTellsThePayloadOverThePort() throws Exception {
        PayloadPort port = PayloadPort.named(VoiceMemoCapability.PORT);
        assertFalse(port.ready());
        CoreRuntime real = TestCore.createWithContext(tmp.newFolder(), new FakeContext(tmp.newFolder()));
        VoiceMemoCapability started = new VoiceMemoCapability(http, null, null, System::currentTimeMillis, () -> true, () -> { });
        real.add(started);
        real.prepare(new JSONObject());
        real.settings().set(Backend.BASE_URL, "https://kiosk.example");
        real.settings().set(Backend.USER, "example-user");
        assertEquals(0, FakeContext.liveThreads(VoiceMemoCapability.WORKER));
        started.start();
        try {
            assertTrue(port.ready());
            assertEquals(1, FakeContext.liveThreads(VoiceMemoCapability.WORKER));
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
        while (FakeContext.liveThreads(VoiceMemoCapability.WORKER) > 0 && System.currentTimeMillis() < deadline) Thread.sleep(10);
        assertEquals(0, FakeContext.liveThreads(VoiceMemoCapability.WORKER));
        started.stop();
    }

    @Test public void withNoAndroidContextNothingStartsAndTheStatusStillAnswers() throws Exception {
        CoreRuntime bare = TestCore.create(tmp.newFolder());
        VoiceMemoCapability plain = new VoiceMemoCapability();
        bare.add(plain);
        bare.prepare(new JSONObject());
        plain.start();
        assertEquals(0, FakeContext.liveThreads(VoiceMemoCapability.WORKER));
        JSONObject queue = TestCore.get(bare, "/memo/queue");
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
        assertEquals("MEMO uploaded 1700000000000-ab12cd34 32 bytes", shell.notes.get(0));
    }
}
