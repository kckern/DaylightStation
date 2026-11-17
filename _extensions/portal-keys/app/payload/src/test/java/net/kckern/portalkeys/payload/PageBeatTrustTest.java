package net.kckern.portalkeys.payload;
import org.junit.Test;
import static org.junit.Assert.*;
public class PageBeatTrustTest {
 @Test public void rejectsUnboundedNonJsonAndChunkedBodiesBeforeReading() {
  java.util.Map<String,String> headers=new java.util.HashMap<>();headers.put("content-type","application/json");headers.put("content-length","2048");
  assertEquals(2048,OpsServer.pageBodyLength(headers));
  for(String length:new String[]{"2049","0","-1","bogus"}) {
   headers.put("content-length",length);
   try { OpsServer.pageBodyLength(headers);fail("accepted invalid length "+length); } catch(IllegalArgumentException expected) {}
  }
  headers.put("content-length","10");headers.put("transfer-encoding","chunked");
  try { OpsServer.pageBodyLength(headers);fail("accepted chunked"); } catch(IllegalArgumentException expected) {}
  headers.remove("transfer-encoding");headers.put("content-type","text/plain");
  try { OpsServer.pageBodyLength(headers);fail("accepted non-json"); } catch(IllegalArgumentException expected) {}
 }
 @Test public void unknownOrStoppedSafetyCannotDispatch() throws Exception {
  org.json.JSONObject safe=new org.json.JSONObject("{\"known\":true,\"expectedAwake\":true,\"stopped\":false,\"maintenance\":false}");
  assertTrue(HomeWatchdog.pageSafe(safe));
  assertFalse(HomeWatchdog.pageSafe(new org.json.JSONObject()));
  assertFalse(HomeWatchdog.pageSafe(new org.json.JSONObject(safe.toString()).put("stopped",true)));
  assertFalse(HomeWatchdog.pageSafe(new org.json.JSONObject(safe.toString()).put("expectedAwake",false)));
  assertFalse(HomeWatchdog.pageSafe(new org.json.JSONObject(safe.toString()).put("maintenance",true)));
  assertFalse(HomeWatchdog.PAGE_RECOVERY_VERIFIED);
 }
 @Test public void onlyConfiguredHttpsOriginAndLoopbackPeerAreTrusted() {
  assertTrue(OpsServer.trustedPage("127.0.0.1","https://school.example","https://school.example"));
  assertTrue(OpsServer.trustedPage("::1","https://school.example","https://school.example"));
  assertFalse(OpsServer.trustedPage("192.0.2.1","https://school.example","https://school.example"));
  assertFalse(OpsServer.trustedPage("127.0.0.1","https://evil.example","https://school.example"));
  assertFalse(OpsServer.trustedPage("127.0.0.1",null,"https://school.example"));
  assertFalse(OpsServer.trustedPage("127.0.0.1","null","null"));
  assertFalse(OpsServer.trustedPage("127.0.0.1","http://school.example","http://school.example"));
 }
}
