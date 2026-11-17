package net.kckern.daylight.cap.midibridge;

import static org.junit.Assert.*;

import net.kckern.daylight.core.CoreRuntime;
import net.kckern.daylight.core.StatusBoard;
import net.kckern.daylight.core.spi.BluetoothRole;
import net.kckern.daylight.core.testing.TestCore;

import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.util.Collections;

public class MidiBridgeCapabilityTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    private CoreRuntime registered() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        new MidiBridgeCapability().register(core);
        return core;
    }

    @Test public void declaresItsSettingsAndOffersTheMidiRole() throws Exception {
        CoreRuntime core = registered();
        assertEquals(15000, core.settings().get("midi.scanTimeoutMs"));
        BluetoothRole role = core.services().find(BluetoothRole.class);
        assertEquals("midi", role.profile());
        assertFalse(role.present());
        assertEquals("", role.connectedAddress());
        assertTrue("with no connector there is no scan to pause", role.pauseDiscovery());
    }

    @Test public void routesAnswerAsTheBridgeDidBeforeTheLinkExists() throws Exception {
        CoreRuntime core = registered();
        assertEquals("no_connector", TestCore.post(core, "/connect").getString("error"));
        assertEquals("no_connector", TestCore.post(core, "/forget").getString("error"));
        assertEquals("loopback not started", TestCore.get(core, "/loopback").getString("error"));
        assertEquals("missing hex", TestCore.post(core, "/midi/send").getString("error"));
        JSONObject odd = TestCore.call(core, "GET", "/midi/send", Collections.singletonMap("hex", "F0 4"), null);
        assertTrue(odd.getString("error").contains("odd number of hex digits"));
        assertEquals(405, TestCore.get(core, "/reset").getInt("_status"));
    }

    @Test public void theHeartbeatSaysTheLinkIsDownWhenThereIsNone() throws Exception {
        CoreRuntime core = registered();
        JSONObject beat = core.status().collect(StatusBoard.Surface.HEARTBEAT, new JSONObject());
        assertEquals("none", beat.getString("ble"));
        assertEquals("DOWN", beat.getString("linkVerdict"));
        assertFalse(beat.getBoolean("midiWriteOpen"));
    }

    @Test public void everyRouteTheOldBridgesClientsUseIsRegistered() throws Exception {
        CoreRuntime core = registered();
        for (String route : new String[] {
                "POST /connect", "POST /forget", "POST /scan",        // pbctl
                "GET /midi/tap",                                       // bridgeMidiTap.js
                "GET /midi/send", "POST /midi/send",                   // bridgeMidiOut.js, pbctl
                "POST /reset",                                         // pianoBridgeClient.js
                "GET /loopback", "POST /loopback",                     // pbctl, backend health probe
                "POST /tone",                                          // pbctl
        }) {
            assertTrue(route, core.router().routes().contains(route));
        }
    }

    @Test public void startWithoutAnAndroidContextDoesNothingAndStopTwiceIsSafe() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        MidiBridgeCapability midi = new MidiBridgeCapability();
        midi.register(core);
        midi.start();
        assertEquals("not_ready", TestCore.get(core, "/midi/tap").getString("error"));
        midi.stop();
        midi.stop();
    }

    /** The piano's heartbeat body lost these fields when the heartbeat moved to core; this is where they come back. */
    @Test public void aLinkContributesEveryMidiFieldTheOldHeartbeatSent() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        MidiBridgeCapability midi = new MidiBridgeCapability();
        midi.register(core);
        midi.useLinkForTest(MidiLink.forTest(new MidiConfig(core.settings()), core.notes(), core.socket()));

        JSONObject beat = core.status().collect(StatusBoard.Surface.HEARTBEAT, new JSONObject());
        for (String field : new String[] { "ble", "bleUptimeS", "bleReconnects", "midiWriteOpen", "midiInOpen",
                "outVerified", "loopRttMs", "loopMisses", "linkVerdict" }) {
            assertTrue(field, beat.has(field));
        }
        // No connector in a JVM test: the values are the old heartbeat's for a bridge with no BLE link.
        assertEquals("none", beat.getString("ble"));
        assertEquals(0, beat.getLong("bleUptimeS"));
        assertEquals(0, beat.getInt("bleReconnects"));
        assertFalse(beat.getBoolean("midiInOpen"));
        assertFalse(beat.getBoolean("outVerified"));
        assertEquals(-1, beat.getLong("loopRttMs"));
        assertEquals("DOWN", beat.getString("linkVerdict"));
        assertFalse(beat.has("_errors"));
    }

    @Test public void theLoopbackProbeRunsBeforeEachHeartbeat() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        MidiBridgeCapability midi = new MidiBridgeCapability();
        midi.register(core);
        MidiLink link = MidiLink.forTest(new MidiConfig(core.settings()), core.notes(), core.socket());
        midi.useLinkForTest(link);
        assertEquals(0, link.getLoopback().snapshot().getInt("probes"));
        core.status().runBeforeHeartbeat();
        JSONObject after = link.getLoopback().snapshot();
        assertEquals(1, after.getInt("probes"));
        // The write port is closed here, so the probe is refused and counted as a miss.
        assertEquals(1, after.getInt("consecutiveMisses"));
    }

    @Test public void statusCarriesTheFieldsTheBackendHealthProbeReads() throws Exception {
        CoreRuntime core = registered();
        JSONObject status = core.status().collect(StatusBoard.Surface.STATUS, new JSONObject());
        assertTrue(status.isNull("ble"));
        assertFalse(status.getJSONObject("midiWrite").getBoolean("open"));
        assertTrue(status.getJSONObject("midiWrite").isNull("lastError"));
    }
}
