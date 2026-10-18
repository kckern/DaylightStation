package net.kckern.pianobridge;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import org.junit.Test;

import java.io.IOException;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Guards the fix for the 2026-07-15 outage: POST /config MERGES, so a partial
 * write (the backend's lone fkbWakeSuppressUntilEpochMs) can never erase
 * targetMac and strand the BLE-MIDI link.
 */
public class DeviceConfigMergeTest {

    private static Map<String, String> parse(String yaml) throws IOException {
        LinkedHashMap<String, String> m = new LinkedHashMap<>();
        DeviceConfig.parseFlat(new ByteArrayInputStream(yaml.getBytes(StandardCharsets.UTF_8)), m);
        return m;
    }

    @Test public void partialWrite_preservesSiblingKeys_theOutage() throws IOException {
        String existing =
                "targetMac: 10:65:36:36:62:66\n" +
                "targetName: jam-7e6\n" +
                "speakerMac: 64:49:A5:8B:9B:75\n";
        String incoming = "fkbWakeSuppressUntilEpochMs: 1784082288995\n";

        Map<String, String> merged = parse(DeviceConfig.mergeOverride(existing, incoming));

        // The whole point: a one-key POST must NOT drop the BLE-MIDI target.
        assertEquals("10:65:36:36:62:66", merged.get("targetMac"));
        assertEquals("jam-7e6", merged.get("targetName"));
        assertEquals("64:49:A5:8B:9B:75", merged.get("speakerMac"));
        assertEquals("1784082288995", merged.get("fkbWakeSuppressUntilEpochMs"));
    }

    @Test public void incomingWins_onKeyCollision() throws IOException {
        String existing = "targetMac: 10:65:36:36:62:66\nreconnectDelayMs: 3000\n";
        String incoming = "reconnectDelayMs: 5000\n";

        Map<String, String> merged = parse(DeviceConfig.mergeOverride(existing, incoming));

        assertEquals("5000", merged.get("reconnectDelayMs"));   // updated
        assertEquals("10:65:36:36:62:66", merged.get("targetMac")); // untouched
    }

    @Test public void mergeOntoEmpty_isJustTheIncoming() throws IOException {
        Map<String, String> merged = parse(DeviceConfig.mergeOverride("", "targetMac: AA:BB\n"));
        assertEquals(1, merged.size());
        assertEquals("AA:BB", merged.get("targetMac"));
    }

    @Test public void bluetoothSelectionAndDisconnectPreserveOtherRoleAndWatchdogConfig() throws IOException {
        String cfg = "targetMac: 12:34:56:78:9A:BC\ntargetName: Keyboard\n"
                + "speakerMac: 22:34:56:78:9A:BC\nspeakerName: Speaker\n"
                + "watchdogEnabled: false\nbluetoothMidiEnabled: false\n";
        cfg = DeviceConfig.mergeOverride(cfg, "speakerMac: 32:34:56:78:9A:BC\nspeakerName: New speaker\nbluetoothAudioEnabled: true\n");
        cfg = DeviceConfig.mergeOverride(cfg, "bluetoothAudioEnabled: false\n");
        Map<String, String> merged = parse(cfg);
        assertEquals("12:34:56:78:9A:BC", merged.get("targetMac"));
        assertEquals("Keyboard", merged.get("targetName"));
        assertEquals("false", merged.get("bluetoothMidiEnabled"));
        assertEquals("32:34:56:78:9A:BC", merged.get("speakerMac"));
        assertEquals("New speaker", merged.get("speakerName"));
        assertEquals("false", merged.get("bluetoothAudioEnabled"));
        assertEquals("false", merged.get("watchdogEnabled"));
    }

    @Test public void repeatedPartialWrites_neverErodeConfig() throws IOException {
        String cfg = "targetMac: 10:65:36:36:62:66\ntargetName: jam-7e6\n";
        // Simulate many wake-suppress relays back to back.
        for (int i = 0; i < 25; i++) {
            cfg = DeviceConfig.mergeOverride(cfg, "fkbWakeSuppressUntilEpochMs: " + (1_000 + i) + "\n");
        }
        Map<String, String> merged = parse(cfg);
        assertEquals("10:65:36:36:62:66", merged.get("targetMac"));
        assertEquals("jam-7e6", merged.get("targetName"));
        assertEquals("1024", merged.get("fkbWakeSuppressUntilEpochMs")); // last write wins
        assertTrue("config must not accumulate junk", merged.size() == 3);
    }
}
