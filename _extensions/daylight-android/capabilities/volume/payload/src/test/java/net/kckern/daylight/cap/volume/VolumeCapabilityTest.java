package net.kckern.daylight.cap.volume;

import static org.junit.Assert.*;

import net.kckern.daylight.core.CoreRuntime;
import net.kckern.daylight.core.spi.VolumeControl;
import net.kckern.daylight.core.testing.FakeContext;
import net.kckern.daylight.core.testing.TestCore;

import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

public class VolumeCapabilityTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();
    private CoreRuntime core;
    private VolumeCapability cap;

    /** A device's streams: 15 steps each, and optionally one that refuses to move. */
    private static final class FakeStreams implements VolumeCapability.Streams {
        final Map<Integer, Integer> index = new HashMap<>();
        int max = 15;
        boolean stuck, refuses;
        @Override public int max(int stream) { return max; }
        @Override public int get(int stream) { Integer i = index.get(stream); return i == null ? 0 : i; }
        @Override public void set(int stream, int i) {
            if (refuses) throw new SecurityException("Not allowed to change Do Not Disturb state");
            if (!stuck) index.put(stream, i);
        }
    }

    @Before public void setUp() throws Exception {
        core = TestCore.create(tmp.newFolder());
        cap = new VolumeCapability();
        assertEquals("volume", cap.name());
        core.add(cap);
        core.prepare(new JSONObject());
    }

    @After public void tearDown() {
        cap.stop();
        TestCore.releaseMainThread();
    }

    private JSONObject call(String method, Map<String, String> query, String body) throws Exception {
        return TestCore.call(core, method, "/volume", query, body);
    }

    private int status(String method, Map<String, String> query, String body) throws Exception {
        return call(method, query, body).getInt("_status");
    }

    @Test public void registersItsRoutesAndService() {
        assertTrue(core.router().routes().contains("GET /volume"));
        assertTrue(core.router().routes().contains("POST /volume"));
        assertNotNull(core.services().find(VolumeControl.class));
    }

    @Test public void rejectsBadInputBeforeTouchingTheDevice() throws Exception {
        FakeStreams streams = new FakeStreams();
        cap.useStreamsForTest(streams);
        assertEquals(400, status("POST", null, "{}"));
        assertEquals(400, status("POST", null, "{\"level\":101}"));
        assertEquals(400, status("POST", null, "{\"level\":-1}"));
        assertEquals(400, status("POST", null, "{\"level\":\"loud\"}"));
        assertEquals(400, status("POST", null, "{\"level\":50,\"stream\":42}"));
        assertEquals(400, status("GET", Collections.singletonMap("stream", "music"), null));
        assertTrue("nothing was set", streams.index.isEmpty());
    }

    @Test public void setsAPercentageRoundingDownAndReadsItBack() throws Exception {
        FakeStreams streams = new FakeStreams();
        cap.useStreamsForTest(streams);
        JSONObject r = call("POST", null, "{\"level\":50}");
        assertEquals(200, r.getInt("_status"));
        assertTrue(r.getBoolean("ok"));
        assertEquals("the music stream when none is named", 3, r.getInt("stream"));
        assertEquals("7.5 rounds down, as Fully does", 7, r.getInt("index"));
        assertEquals(15, r.getInt("maxIndex"));
        assertEquals(7, (int) streams.index.get(3));

        JSONObject read = call("GET", Collections.singletonMap("stream", "3"), null);
        assertEquals(7, read.getInt("index"));
        assertEquals(15, read.getInt("maxIndex"));
        assertEquals(3, read.getInt("stream"));
        // What is read can be written back without moving the volume.
        JSONObject again = call("POST", null, "{\"level\":" + read.getInt("level") + "}");
        assertEquals(7, again.getInt("index"));

        JSONObject alarm = call("POST", null, "{\"level\":100,\"stream\":4}");
        assertEquals(4, alarm.getInt("stream"));
        assertEquals(15, alarm.getInt("index"));
        assertEquals(100, alarm.getInt("level"));
        assertEquals("the music stream is untouched", 7, (int) streams.index.get(3));
        assertEquals("with no stream named, GET reads music", 7, call("GET", null, null).getInt("index"));
    }

    @Test public void aChangeTheDeviceDidNotMakeIsNotOk() throws Exception {
        FakeStreams streams = new FakeStreams();
        streams.index.put(3, 2);
        streams.stuck = true;
        cap.useStreamsForTest(streams);
        JSONObject r = call("POST", null, "{\"level\":80}");
        assertEquals(200, r.getInt("_status"));
        assertFalse("ok only when the index read back is the one asked for", r.getBoolean("ok"));
        assertEquals("volume_unchanged", r.getString("error"));
        assertEquals("the answer carries what is true", 2, r.getInt("index"));
    }

    @Test public void aRefusedChangeAnswersWithWhatTheStreamReads() throws Exception {
        FakeStreams streams = new FakeStreams();
        streams.index.put(3, 4);
        streams.refuses = true;
        cap.useStreamsForTest(streams);
        JSONObject r = call("POST", null, "{\"level\":0}");
        assertEquals(200, r.getInt("_status"));
        assertFalse(r.getBoolean("ok"));
        assertEquals(4, r.getInt("index"));
    }

    @Test public void thePageReadsThroughTheService() throws Exception {
        FakeStreams streams = new FakeStreams();
        streams.index.put(3, 15);
        cap.useStreamsForTest(streams);
        JSONObject read = core.services().find(VolumeControl.class).read(3);
        assertEquals(100, read.getInt("level"));
        assertEquals(15, read.getInt("index"));
        assertEquals(15, read.getInt("maxIndex"));
        assertFalse("the bridge's answer has no ok field of its own", read.has("ok"));
    }

    @Test public void withNoAudioServiceTheRoutesSayUnsupported() throws Exception {
        JSONObject r = call("GET", null, null);
        assertEquals(501, r.getInt("_status"));
        assertEquals("unsupported", r.getString("error"));
        assertEquals(501, status("POST", null, "{\"level\":50}"));
        assertEquals("the page gets an empty object, not an exception", 0, core.services().find(VolumeControl.class).read(3).length());
    }

    @Test public void aRealStartOverAContextWithNoAudioServiceRunsAndStopsTwice() throws Exception {
        cap.stop();
        File dir = tmp.newFolder();
        core = TestCore.createWithContext(dir, new FakeContext(dir));
        cap = new VolumeCapability();
        core.add(cap);
        core.prepare(new JSONObject());
        cap.start();
        // The fake context has no audio service: the capability starts, and says so when asked.
        assertEquals("no audio service on this device", call("GET", null, null).getString("reason"));
        FakeStreams streams = new FakeStreams();
        cap.useStreamsForTest(streams);
        assertEquals(200, status("POST", null, "{\"level\":20}"));
        cap.stop();
        assertEquals("stopped: the streams are let go", 501, status("GET", null, null));
        cap.stop();
    }
}
