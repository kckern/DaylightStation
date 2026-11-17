package net.kckern.daylight.cap.midibridge;

import static org.junit.Assert.*;

import android.media.midi.MidiReceiver;

import net.kckern.daylight.core.CoreRuntime;
import net.kckern.daylight.core.SocketHub;
import net.kckern.daylight.core.spi.NoteListener;
import net.kckern.daylight.core.testing.TestCore;

import org.json.JSONObject;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.util.ArrayList;
import java.util.List;

/**
 * The note stream on the control WebSocket must be what the piano page already reads
 * (usePianoBridgeNotes.js: `type`, `note`, `velocity`, `t`).
 *
 * OLD_FRAMES is the old bridge's own output. It was produced by taking
 * midiEventEpochMs and buildNote out of the piano-bridge ControlServer.java source
 * with a script, unmodified, compiling them into a class with a main(), and running
 * it against org.json 20231013 (the version on this test classpath) with the calls
 * listed beside each line. The key order is that library's; on a device Android's
 * org.json writes keys in insertion order (type, note, velocity, t) for the old and
 * the new code alike, since the builder is the same code.
 */
public class NoteStreamCompatibilityTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    /** t = midiEventEpochMs(4_963_000_000L, 1_800_000_000_123L, 5_000_000_000L) = 1800000000086. */
    private static final String[] OLD_FRAMES = {
            "{\"note\":60,\"t\":1800000000086,\"velocity\":90,\"type\":\"note.on\"}",    // buildNote("note.on", 60, 90, t)
            "{\"note\":60,\"t\":1800000000086,\"type\":\"note.off\"}",                   // buildNote("note.off", 60, -1, t)
            "{\"note\":64,\"velocity\":1,\"type\":\"note.on\"}",                         // buildNote("note.on", 64, 1, 0)
            "{\"note\":64,\"type\":\"note.off\"}",                                       // buildNote("note.off", 64, -1, 0)
            "{\"note\":127,\"t\":1800000000999,\"velocity\":127,\"type\":\"note.on\"}",  // buildNote("note.on", 127, 127, 1800000000999)
    };

    /** Frames arrive on the hub's sending thread; `seen`, when set, records each one's arrival. */
    private static final class Client implements SocketHub.Client {
        final List<String> sent = new java.util.concurrent.CopyOnWriteArrayList<>();
        volatile List<String> seen;
        @Override public void send(String text) {
            sent.add(text);
            List<String> log = seen;
            if (log != null) {
                try { log.add("page." + new JSONObject(text).getString("type").substring(5)); } catch (Exception ignored) { }
            }
        }
        @Override public void ping() { }
        @Override public void close() { }
    }

    private CoreRuntime core;
    private Client client;
    private MidiReceiver receiver;
    private final List<String> order = java.util.Collections.synchronizedList(new ArrayList<>());

    @Before public void setUp() throws Exception {
        core = TestCore.create(tmp.newFolder());
        MidiConfig.declare(core.settings());
        client = new Client();
        core.socket().opened(client);
        core.socket().awaitDelivered(2000);
        client.sent.clear();   // drop the hub's "ready" frame
        core.notes().subscribe(new NoteListener() {
            @Override public void noteOn(int note, int velocity, long epochMs) { order.add("bus.on " + note + " " + velocity + " seen-frames=" + client.sent.size()); }
            @Override public void noteOff(int note, long epochMs) { order.add("bus.off " + note + " seen-frames=" + client.sent.size()); }
            @Override public void controlChange(int controller, int value) { order.add("bus.cc " + controller + " " + value); }
        });
        receiver = MidiLink.forTest(new MidiConfig(core.settings()), core.notes(), core.socket()).receiverForTest();
    }

    private void midi(int... bytes) throws Exception {
        byte[] b = new byte[bytes.length];
        for (int i = 0; i < bytes.length; i++) b[i] = (byte) bytes[i];
        receiver.onSend(b, 0, b.length, 0L);
    }

    @Test public void theFrameBuilderProducesTheOldBridgesBytes() {
        long t = MidiWire.midiEventEpochMs(4_963_000_000L, 1_800_000_000_123L, 5_000_000_000L);
        assertEquals(OLD_FRAMES[0], MidiWire.buildNote("note.on", 60, 90, t));
        assertEquals(OLD_FRAMES[1], MidiWire.buildNote("note.off", 60, -1, t));
        assertEquals(OLD_FRAMES[2], MidiWire.buildNote("note.on", 64, 1, 0L));
        assertEquals(OLD_FRAMES[3], MidiWire.buildNote("note.off", 64, -1, 0L));
        assertEquals(OLD_FRAMES[4], MidiWire.buildNote("note.on", 127, 127, 1_800_000_000_999L));
    }

    @Test public void aKeyPressBecomesTheOldNoteOnFrame() throws Exception {
        long before = System.currentTimeMillis();
        midi(0x90, 60, 90);
        long after = System.currentTimeMillis();
        core.socket().awaitDelivered(2000);
        assertEquals(1, client.sent.size());
        core.socket().awaitDelivered(2000);
        JSONObject frame = new JSONObject(client.sent.get(0));
        long t = frame.getLong("t");
        assertTrue("t is the event's epoch ms", t >= before && t <= after);
        // Byte for byte what the old builder gives for this note at this time.
        core.socket().awaitDelivered(2000);
        assertEquals(OLD_FRAMES[0].replace("1800000000086", String.valueOf(t)), client.sent.get(0));
        assertEquals(4, frame.length());
    }

    @Test public void aKeyReleaseBecomesTheOldNoteOffFrameWithNoVelocity() throws Exception {
        midi(0x80, 60, 64);
        midi(0x90, 60, 0);   // note-on with velocity 0 is a release
        core.socket().awaitDelivered(2000);
        assertEquals(2, client.sent.size());
        core.socket().awaitDelivered(2000);
        for (String sent : client.sent) {
            JSONObject frame = new JSONObject(sent);
            assertEquals(OLD_FRAMES[1].replace("1800000000086", String.valueOf(frame.getLong("t"))), sent);
            assertFalse(frame.has("velocity"));
            assertEquals(3, frame.length());
        }
    }

    @Test public void subscribersHearANoteBeforeThePageDoes() throws Exception {
        // The page's frames leave on the hub's sending thread, so what is compared is the
        // order of arrival: the bus is told on the MIDI thread before the frame is queued.
        client.seen = order;
        midi(0x90, 60, 90, 0x80, 60, 0);
        core.socket().awaitDelivered(2000);
        assertEquals(2, client.sent.size());
        assertTrue(order.toString(), order.indexOf("bus.on 60 90 seen-frames=0") == 0);
        assertTrue(order.toString(), order.indexOf("page.on") > 0);
        int busOff = -1;
        for (int i = 0; i < order.size(); i++) if (order.get(i).startsWith("bus.off 60")) busOff = i;
        assertTrue(order.toString(), busOff > 0 && busOff < order.indexOf("page.off"));
        assertTrue("the page gets on before off", order.indexOf("page.on") < order.indexOf("page.off"));
    }

    @Test public void runningStatusTheEchoProbeAndControlChangesBehaveAsBefore() throws Exception {
        // Three note-ons under one status byte, as the instrument sends them.
        midi(0x90, 60, 100, 62, 100, 64, 100);
        core.socket().awaitDelivered(2000);
        assertEquals(3, client.sent.size());
        core.socket().awaitDelivered(2000);
        assertEquals(64, new JSONObject(client.sent.get(2)).getInt("note"));
        core.socket().awaitDelivered(2000);
        client.sent.clear();
        order.clear();

        // The loopback probe note coming back is swallowed: no frame, nothing on the bus.
        midi(0x90, Loopback.PROBE_NOTE, 1);
        midi(0x80, Loopback.PROBE_NOTE, 0);
        core.socket().awaitDelivered(2000);
        assertTrue(client.sent.isEmpty());
        assertTrue(order.isEmpty());

        // A control change goes to subscribers (the synth) and is not sent to the page.
        midi(0xB0, 64, 127);
        assertEquals(java.util.Collections.singletonList("bus.cc 64 127"), order);
        core.socket().awaitDelivered(2000);
        assertTrue(client.sent.isEmpty());
    }
}
