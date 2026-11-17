package net.kckern.daylight.cap.notifications;

import static org.junit.Assert.*;

import net.kckern.daylight.core.CoreRuntime;
import net.kckern.daylight.core.spi.LinkKeySource;
import net.kckern.daylight.core.spi.LocalNotices;
import net.kckern.daylight.core.testing.FakeContext;
import net.kckern.daylight.core.testing.FakeShell;
import net.kckern.daylight.core.testing.TestCore;

import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.util.ArrayList;
import java.util.List;

public class LocalNoticesTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();
    private CoreRuntime core;
    private NotificationsCapability cap;
    private final List<String> posted = new ArrayList<>();
    private final List<Integer> cancelled = new ArrayList<>();
    private int channelsMade;
    private RuntimeException sinkFailure;
    private String permission = "denied";

    @Before public void setUp() throws Exception {
        core = TestCore.create(tmp.newFolder());
        cap = new NotificationsCapability(new NotificationsCapability.NoticeSink() {
            @Override public void ensureChannels() { if (sinkFailure != null) throw sinkFailure; channelsMade++; }
            @Override public void post(Notice notice) {
                if (sinkFailure != null) throw sinkFailure;
                posted.add(notice.androidChannel() + " " + notice.title + ": " + notice.text + " -> " + notice.uri);
            }
            @Override public void cancel(int androidId) { cancelled.add(androidId); }
            @Override public String permission() { return permission; }
        });
        core.add(cap);
        core.prepare(new JSONObject());
    }

    @After public void tearDown() { cap.stop(); TestCore.releaseMainThread(); }

    private LocalNotices notices() { return core.services().find(LocalNotices.class); }

    @Test public void startCreatesTheChannelsAndAPostReachesTheSinkWithItsKeyedLink() {
        cap.start();
        assertEquals(1, channelsMade);
        notices().post("memo-queue", LocalNotices.UPLOADS, "Voice memos", "2 voice memos waiting to upload", "daylight://memo/queue");
        String key = core.services().find(LinkKeySource.class).installKey();
        assertEquals("daylight_uploads Voice memos: 2 voice memos waiting to upload -> daylight://memo/queue#k=" + key, posted.get(0));
    }

    @Test public void cancelUsesTheSameAndroidIdThePostDid() {
        cap.start();
        notices().post("memo-queue", LocalNotices.UPLOADS, "Voice memos", "", "");
        notices().cancel("memo-queue");
        assertEquals(Notice.androidId("memo-queue"), (int) cancelled.get(0));
    }

    @Test public void aNoticeThatCannotBePostedIsRefusedAndNothingIsShown() {
        cap.start();
        try { notices().post("x", "alarms", "t", "", ""); fail(); } catch (IllegalArgumentException expected) { }
        try { notices().post("x", LocalNotices.GENERAL, "t", "", "https://evil.example/"); fail(); } catch (IllegalArgumentException expected) { }
        assertTrue(posted.isEmpty());
    }

    @Test public void theRoutesDoTheSameAndTheStatusSaysWhetherNotificationsAreAllowed() throws Exception {
        cap.start();
        JSONObject r = TestCore.call(core, "POST", "/notify", null,
                "{\"id\":\"memo-queue\",\"channel\":\"uploads\",\"title\":\"Voice memos\",\"text\":\"2 waiting\"}");
        assertEquals(200, r.getInt("_status"));
        assertEquals(Notice.androidId("memo-queue"), r.getInt("androidId"));
        assertEquals(400, TestCore.call(core, "POST", "/notify", null, "{\"id\":\"x\",\"channel\":\"nope\",\"title\":\"t\"}").getInt("_status"));
        assertEquals(200, TestCore.call(core, "POST", "/notify/cancel", null, "{\"id\":\"memo-queue\"}").getInt("_status"));
        assertEquals(400, TestCore.call(core, "POST", "/notify/cancel", null, "{}").getInt("_status"));
        JSONObject status = TestCore.get(core, "/notify/status");
        assertEquals("denied", status.getString("permission"));
        assertEquals(2, status.getJSONArray("channels").length());
        assertFalse("the key is in no answer", r.toString().contains(core.services().find(LinkKeySource.class).installKey()));
    }

    @Test public void aDeviceThatRefusesAChannelDoesNotStopThePayload() {
        sinkFailure = new SecurityException("no");
        cap.start();
        assertTrue(((FakeShell) core.shell()).notes.toString().contains("NOTIFY could not create channels: SecurityException"));
    }

    @Test public void withNoAndroidContextAPostShowsNothingAndDoesNotThrow() throws Exception {
        CoreRuntime bare = TestCore.create(tmp.newFolder());
        NotificationsCapability plain = new NotificationsCapability();
        bare.add(plain);
        bare.prepare(new JSONObject());
        plain.start();
        try {
            bare.services().find(LocalNotices.class).post("memo-queue", LocalNotices.UPLOADS, "Voice memos", "", "");
            bare.services().find(LocalNotices.class).cancel("memo-queue");
            assertEquals("unavailable", TestCore.get(bare, "/notify/status").getString("permission"));
        } finally {
            plain.stop();
        }
    }

    /** FakeContext has no notification service, as a device without one: nothing is taken and nothing throws. */
    @Test public void aRealStartOverAContextWithNoNotificationServiceTakesNothing() throws Exception {
        FakeContext context = new FakeContext(tmp.newFolder());
        CoreRuntime real = TestCore.createWithContext(tmp.newFolder(), context);
        NotificationsCapability started = new NotificationsCapability();
        real.add(started);
        real.prepare(new JSONObject());
        started.start();
        try {
            real.services().find(LocalNotices.class).post("memo-queue", LocalNotices.UPLOADS, "Voice memos", "1 waiting", "daylight://memo/queue");
            real.services().find(LocalNotices.class).cancel("memo-queue");
            assertEquals("unavailable", TestCore.get(real, "/notify/status").getString("permission"));
            assertEquals(0, context.receivers.size());
        } finally {
            started.stop();
        }
        started.stop();
    }
}
