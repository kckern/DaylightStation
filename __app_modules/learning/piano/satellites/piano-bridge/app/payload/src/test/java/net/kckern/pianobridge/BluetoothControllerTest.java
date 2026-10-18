package net.kckern.pianobridge;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

/** Exercise command validation and real-state reporting at the Android boundary. */
public class BluetoothControllerTest {
    private static final String MAC = "12:34:56:78:9A:BC";

    private static class FakePort implements BluetoothController.Port {
        String action, address, profile, pin;
        int duration;
        boolean accepted = true, enabled = true;
        JSONObject pairing;
        public JSONObject snapshot() throws Exception {
            return new JSONObject().put("ok", true)
                .put("adapter", new JSONObject().put("enabled", enabled))
                .put("devices", new JSONArray().put(new JSONObject().put("address", MAC)
                    .put("bond", "none").put("connected", false)))
                .put("pairing", pairing == null ? JSONObject.NULL : pairing);
        }
        public boolean scan(int ms) { action="scan"; duration=ms; return accepted; }
        public boolean stopScan() { action="stop"; return accepted; }
        public boolean pair(String mac) { action="pair"; address=mac; return accepted; }
        public boolean unpair(String mac) { action="unpair"; address=mac; return accepted; }
        public boolean connect(String mac, String role) { action="connect"; address=mac; profile=role; return accepted; }
        public boolean disconnect(String mac, String role) { action="disconnect"; address=mac; profile=role; return accepted; }
        public boolean setEnabled(boolean value) { action="power"; enabled=value; return accepted; }
        public boolean reply(String mac, boolean accept, String code) { action="reply"; address=mac; pin=code; return accepted; }
    }

    @Test public void acceptedPairingDoesNotInventBondedOrConnectedState() throws Exception {
        FakePort port = new FakePort();
        BluetoothController ctl = new BluetoothController(port, () -> 1000L);
        assertTrue(ctl.command("pair", new JSONObject().put("address", MAC)).getBoolean("accepted"));
        JSONObject device = ctl.snapshot().getJSONArray("devices").getJSONObject(0);
        assertEquals("none", device.getString("bond"));
        assertFalse(device.getBoolean("connected"));
    }

    @Test public void normalizesMacButRejectsMalformedAddressesBeforeAndroid() throws Exception {
        FakePort port = new FakePort();
        BluetoothController ctl = new BluetoothController(port, () -> 1000L);
        assertTrue(ctl.command("unpair", new JSONObject().put("address", MAC.toLowerCase())).getBoolean("ok"));
        assertEquals(MAC, port.address);
        port.action = null;
        assertEquals("invalid_request", ctl.command("pair", new JSONObject().put("address", "bad\naddress")).getString("code"));
        assertNull(port.action);
    }

    @Test public void boundsScanningAndDoesNotStartAnUnboundedDiscovery() throws Exception {
        FakePort port = new FakePort();
        BluetoothController ctl = new BluetoothController(port, () -> 1000L);
        assertTrue(ctl.command("scan", new JSONObject()).getBoolean("ok"));
        assertEquals(12000, port.duration);
        for (int ms : new int[]{0, -1, 999, 30001}) {
            port.action = null;
            assertFalse(ctl.command("scan", new JSONObject().put("durationMs", ms)).getBoolean("ok"));
            assertNull(port.action);
        }
    }

    @Test public void requiresExplicitSupportedProfileAndBooleanPower() throws Exception {
        FakePort port = new FakePort();
        BluetoothController ctl = new BluetoothController(port, () -> 1000L);
        assertFalse(ctl.command("connect", new JSONObject().put("address", MAC)).getBoolean("ok"));
        assertFalse(ctl.command("connect", new JSONObject().put("address", MAC).put("profile", "unknown")).getBoolean("ok"));
        assertFalse(ctl.command("power", new JSONObject().put("enabled", "false")).getBoolean("ok"));
        assertNull(port.action);
        assertTrue(ctl.command("connect", new JSONObject().put("address", MAC).put("profile", "midi")).getBoolean("ok"));
        assertEquals("midi", port.profile);
    }

    @Test public void rejectedAndroidCommandIsNotReportedAsSuccess() throws Exception {
        FakePort port = new FakePort(); port.accepted = false;
        JSONObject result = new BluetoothController(port, () -> 1000L)
            .command("pair", new JSONObject().put("address", MAC));
        assertFalse(result.getBoolean("ok"));
        assertEquals("action_rejected", result.getString("code"));
    }

    @Test public void pairingReplyIsBoundToUnexpiredLocallyRequestedDevice() throws Exception {
        FakePort port = new FakePort();
        BluetoothController ctl = new BluetoothController(port, () -> 1000L);
        JSONObject reply = new JSONObject().put("address", MAC).put("accept", true);
        assertFalse(ctl.command("pairing", reply).getBoolean("ok"));
        port.pairing = new JSONObject().put("address", "22:34:56:78:9A:BC").put("expiresAtMs", 2000L);
        assertFalse(ctl.command("pairing", reply).getBoolean("ok"));
        port.pairing.put("address", MAC).put("expiresAtMs", 999L);
        assertFalse(ctl.command("pairing", reply).getBoolean("ok"));
        assertNull(port.action);
        port.pairing.put("expiresAtMs", 2000L).put("variant", "pin");
        assertTrue(ctl.command("pairing", reply.put("pin", "0042")).getBoolean("ok"));
        assertEquals("0042", port.pin);
    }

    @Test public void httpBoundaryRejectsGetMutationsAndMalformedJsonWithoutCallingAndroid() throws Exception {
        FakePort port = new FakePort();
        BluetoothController ctl = new BluetoothController(port, () -> 1000L);
        for (String action : new String[]{"scan", "scan/stop", "pair", "unpair", "connect", "disconnect", "pairing", "power"}) {
            assertFalse(ctl.request("GET", action, "{}").getBoolean("ok"));
            assertNull(port.action);
        }
        for (String body : new String[]{"", "{", "[]", "null", "{} trailing", "{}{}"}) {
            assertEquals("invalid_request", ctl.request("POST", "scan/stop", body).getString("code"));
            assertNull(port.action);
        }
        assertTrue(ctl.request("GET", "", null).getBoolean("ok"));
        assertTrue(ctl.request("POST", "scan/stop", "{}").getBoolean("accepted"));
        assertEquals("stop", port.action);
    }

    @Test public void pairingPromptOwnershipRequiresMatchingUnexpiredExplicitRequestForEveryVariant() {
        assertFalse(BluetoothController.ownsPairingRequest(null, 2000L, MAC, 1000L));
        assertFalse(BluetoothController.ownsPairingRequest(MAC, 2000L, "22:34:56:78:9A:BC", 1000L));
        assertFalse(BluetoothController.ownsPairingRequest(MAC, 1000L, MAC, 1000L));
        assertFalse(BluetoothController.ownsPairingRequest(MAC, 999L, MAC, 1000L));
        assertTrue(BluetoothController.ownsPairingRequest(MAC, 2000L, MAC, 1000L));
    }

    @Test public void validatesReplyBooleanRequiredPinAndUtf8ByteLength() throws Exception {
        FakePort port = new FakePort();
        port.pairing = new JSONObject().put("address", MAC).put("expiresAtMs", 2000L).put("variant", "pin");
        BluetoothController ctl = new BluetoothController(port, () -> 1000L);
        assertFalse(ctl.command("pairing", new JSONObject().put("address", MAC).put("accept", "true").put("pin", "42")).getBoolean("ok"));
        assertFalse(ctl.command("pairing", new JSONObject().put("address", MAC).put("accept", true)).getBoolean("ok"));
        assertFalse(ctl.command("pairing", new JSONObject().put("address", MAC).put("accept", true).put("pin", "ééééééééé")).getBoolean("ok"));
        assertNull(port.action);
        assertTrue(ctl.command("pairing", new JSONObject().put("address", MAC).put("accept", false)).getBoolean("ok"));
        assertEquals("reply", port.action);
    }

    @Test public void scanRejectsFractionalAndTextDurationsAndAcceptsBothBounds() throws Exception {
        FakePort port = new FakePort();
        BluetoothController ctl = new BluetoothController(port, () -> 1000L);
        for (Object value : new Object[]{1000.5, "12000", JSONObject.NULL, true}) {
            assertFalse(ctl.command("scan", new JSONObject().put("durationMs", value)).getBoolean("ok"));
            assertNull(port.action);
        }
        assertTrue(ctl.command("scan", new JSONObject().put("durationMs", 1000)).getBoolean("ok"));
        assertEquals(1000, port.duration);
        assertTrue(ctl.command("scan", new JSONObject().put("durationMs", 30000)).getBoolean("ok"));
        assertEquals(30000, port.duration);
    }

    @Test public void invalidPinNeverReachesAndroidAndIsNotEchoedInError() throws Exception {
        FakePort port = new FakePort();
        port.pairing = new JSONObject().put("address", MAC).put("expiresAtMs", 2000L).put("variant", "pin");
        BluetoothController ctl = new BluetoothController(port, () -> 1000L);
        for (String pin : new String[]{"", "12345678901234567", "12\n34"}) {
            JSONObject result = ctl.command("pairing", new JSONObject().put("address", MAC).put("accept", true).put("pin", pin));
            assertFalse(result.getBoolean("ok"));
            if (!pin.isEmpty()) assertFalse(result.toString().contains(pin));
            assertNull(port.action);
        }
    }
}
