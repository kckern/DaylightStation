package net.kckern.audiobridge;
import org.junit.Test;
import static org.junit.Assert.*;
import org.json.JSONObject;
public class PairingSessionTest {
 @Test public void answeredPromptKeepsSelectedDeviceUntilBondEndsOrDeadlineExpires() throws Exception {
  PairingSession session=new PairingSession();session.begin("AA:BB:CC:DD:EE:FF",1000);
  session.showPrompt(new JSONObject().put("variant","pin"));session.replyAccepted();
  assertNull(session.prompt());assertTrue(session.owns("AA:BB:CC:DD:EE:FF",2000));
  assertFalse(session.owns("AA:BB:CC:DD:EE:FF",61000));
  session.clear();assertFalse(session.owns("AA:BB:CC:DD:EE:FF",2000));
 }
 @Test public void missingPermissionOrHidProxyIsUnknownRatherThanDisconnected() {
  assertNull(BluetoothControls.observedConnection(false,false,false,false));
  assertNull(BluetoothControls.observedConnection(true,true,false,false));
  assertEquals(Boolean.FALSE,BluetoothControls.observedConnection(true,true,true,false));
  assertEquals(Boolean.TRUE,BluetoothControls.observedConnection(true,true,true,true));
  assertEquals(Boolean.FALSE,BluetoothControls.observedConnection(true,false,false,false));
 }
}
