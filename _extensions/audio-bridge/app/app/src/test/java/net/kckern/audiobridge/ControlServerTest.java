package net.kckern.audiobridge;
import org.junit.Test;
import static org.junit.Assert.*;
import java.net.*;
import java.io.*;
import org.json.*;

public class ControlServerTest {
    @Test public void rejectsGetActionsAndOversizedBodiesAndServesStatus() throws Exception {
        BluetoothControllerTest.FakePort port = new BluetoothControllerTest.FakePort();
        ControlServer server = new ControlServer(0, new BluetoothController(port, () -> 0));
        server.start(1000, true);
        try {
            String base = "http://127.0.0.1:" + server.getListeningPort();
            HttpURLConnection read = (HttpURLConnection)new URL(base+"/bluetooth").openConnection();
            assertEquals(200, read.getResponseCode()); read.disconnect();
            HttpURLConnection bad = (HttpURLConnection)new URL(base+"/bluetooth/unpair").openConnection();
            assertEquals(405, bad.getResponseCode()); bad.disconnect(); assertNull(port.action);
            HttpURLConnection big = (HttpURLConnection)new URL(base+"/bluetooth/scan").openConnection();
            big.setRequestMethod("POST"); big.setDoOutput(true); big.setRequestProperty("Content-Type","application/json");
            big.getOutputStream().write(new byte[8193]); assertEquals(400,big.getResponseCode()); big.disconnect(); assertNull(port.action);
            HttpURLConnection cmd = (HttpURLConnection)new URL(base+"/bluetooth/scan/stop").openConnection();
            cmd.setRequestMethod("POST");cmd.setDoOutput(true);cmd.setRequestProperty("Content-Type","application/json");
            cmd.getOutputStream().write("{}".getBytes("UTF-8")); assertEquals(202,cmd.getResponseCode());cmd.disconnect();
            assertEquals("stop",port.action);
        } finally { server.stop(); }
    }
    @Test public void distinguishesJoystickAndGamepadFromKeyboardAndRemote() {
        assertTrue(BluetoothControls.isGamepadClass(0x2508));
        assertTrue(BluetoothControls.isGamepadClass(0x2504));
        assertFalse(BluetoothControls.isGamepadClass(0x2540));
        assertFalse(BluetoothControls.isGamepadClass(0x250c));
        assertFalse(BluetoothControls.isGamepadClass(0));
    }
}
