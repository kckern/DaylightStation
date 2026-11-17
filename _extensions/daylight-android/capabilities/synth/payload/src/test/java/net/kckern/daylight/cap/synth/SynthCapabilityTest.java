package net.kckern.daylight.cap.synth;

import static org.junit.Assert.*;

import net.kckern.daylight.core.CoreRuntime;
import net.kckern.daylight.core.SocketHub;
import net.kckern.daylight.core.StatusBoard;
import net.kckern.daylight.core.spi.OutputGate;
import net.kckern.daylight.core.testing.TestCore;

import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.util.ArrayList;
import java.util.List;

public class SynthCapabilityTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    private static final class Client implements SocketHub.Client {
        final List<String> sent = new ArrayList<>();
        @Override public void send(String text) { sent.add(text); }
        @Override public void ping() { }
        @Override public void close() { }
        JSONObject last() throws Exception { return new JSONObject(sent.get(sent.size() - 1)); }
    }

    @Test public void withoutAnEngineTheFrameSaysStoppedAndPresetLoadIsRefused() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        new SynthCapability().register(core);

        JSONObject frame = core.status().collect(StatusBoard.Surface.FRAME, new JSONObject());
        assertEquals("stopped", frame.getString("engine"));
        assertTrue(frame.isNull("preset"));
        assertEquals(-1, frame.getInt("cpu"));
        assertEquals(-1, frame.getInt("xruns"));

        Client client = new Client();
        core.socket().opened(client);
        core.socket().message(client, "{\"type\":\"preset.load\",\"spec\":{\"id\":\"grand\"}}");
        assertEquals("no_engine", client.last().getString("code"));
        core.socket().message(client, "{\"type\":\"preset.load\"}");
        assertEquals("no_spec", client.last().getString("code"));
        core.socket().message(client, "{\"type\":\"param.set\"}");
        assertEquals("no_path", client.last().getString("code"));
    }

    @Test public void panicAndTheNoteRelayAreSafeWithoutAnEngine() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        new SynthCapability().register(core);
        assertEquals("panic", TestCore.post(core, "/panic").getString("action"));
        Client client = new Client();
        core.socket().opened(client);
        int before = client.sent.size();
        core.socket().message(client, "{\"type\":\"note.on\",\"note\":60,\"velocity\":90}");
        core.socket().message(client, "{\"type\":\"engine.start\"}");
        assertEquals("no error frames", before, client.sent.size());
    }

    @Test public void startWithoutAnAndroidContextProvidesNothingAndStopTwiceIsSafe() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        SynthCapability synth = new SynthCapability();
        synth.register(core);
        synth.start();
        assertNull(core.services().find(OutputGate.class));
        synth.stop();
        synth.stop();
    }
}
