package net.kckern.portalkeys.payload;
import fi.iki.elonen.NanoHTTPD;
import net.kckern.portalkeys.api.ShellServices;
import org.junit.Test;
import java.io.ByteArrayInputStream;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.Scanner;
import static org.junit.Assert.*;
public class LockdownRouteTest {
  static LockdownRoute.Decision d(String token, String body) { return LockdownRoute.decide("secret", token, body, 1000); }
  @Test public void refusesAWrongOrMissingToken() {
    assertEquals(401, d("wrong", "{\"locked\":true}").status);
    assertEquals(401, d(null, "{\"locked\":true}").status);
    assertEquals(401, LockdownRoute.decide("", "", "{\"locked\":true}", 1000).status);
  }
  @Test public void locksUntilADeadlineOrIndefinitely() {
    assertEquals(Long.valueOf(5000), d("secret", "{\"locked\":true,\"lockedUntil\":5000}").until);
    assertEquals(Long.valueOf(Long.MAX_VALUE), d("secret", "{\"locked\":true,\"lockedUntil\":null}").until);
    assertEquals(Long.valueOf(Long.MAX_VALUE), d("secret", "{\"locked\":true}").until);
    assertTrue(LockdownRoute.active(5000, 1000)); assertTrue(LockdownRoute.active(Long.MAX_VALUE, 1000));
  }
  @Test public void releaseClears() {
    assertEquals(Long.valueOf(0), d("secret", "{\"locked\":false,\"lockedUntil\":null}").until);
    assertFalse(LockdownRoute.active(0, 1000));
  }
  @Test public void malformedNeverReleases() {
    for (String body : new String[]{null, "", "{}", "{broken", "{\"locked\":\"true\"}", "{\"locked\":true,\"lockedUntil\":500}", "{\"locked\":true,\"lockedUntil\":1500.5}", "{\"locked\":false} x", "{\"locked\":true,\"revision\":3}"}) {
      LockdownRoute.Decision decision = d("secret", body);
      assertEquals("accepted: " + body, 400, decision.status);
      assertNull(decision.until);
    }
  }
  @Test public void orderedFallbackRelaysShellAcknowledgementsAndConflicts() {
    byte[] body = "{\"locked\":false,\"revision\":7}".getBytes(StandardCharsets.UTF_8);
    Map<String, String> headers = new HashMap<>();
    headers.put("content-length", String.valueOf(body.length));
    headers.put("x-lockdown-token", "test-token");
    for (int status : new int[] {200, 409}) {
      String reply = status == 200 ? "{\"lockdownProtocolVersion\":2,\"lockdownRevision\":7}"
          : "{\"error\":\"stale or conflicting lockdown revision\"}";
      ShellServices shell = (ShellServices)
          Proxy.newProxyInstance(getClass().getClassLoader(),
              new Class<?>[] {ShellServices.class}, (proxy, method, args) -> {
                switch (method.getName()) {
                  case "context": return null;
                  case "shellVersionCode": return 36;
                  case "applyLockdown":
                    assertEquals("test-token", args[0]);
                    assertEquals(new String(body, StandardCharsets.UTF_8), args[1]);
                    return new ShellServices.LockdownReply(status, reply);
                  default: throw new AssertionError(method.getName());
                }
              });
      NanoHTTPD.IHTTPSession request = (NanoHTTPD.IHTTPSession)
          Proxy.newProxyInstance(getClass().getClassLoader(),
              new Class<?>[] {NanoHTTPD.IHTTPSession.class}, (proxy, method, args) -> {
                switch (method.getName()) {
                  case "getUri": return "/lockdown";
                  case "getMethod": return NanoHTTPD.Method.PUT;
                  case "getHeaders": return headers;
                  case "getInputStream": return new ByteArrayInputStream(body);
                  default: throw new AssertionError(method.getName());
                }
              });
      NanoHTTPD.Response response = new OpsServer(shell, null, null, null, null).serve(request);
      assertEquals(status, response.getStatus().getRequestStatus());
      assertEquals(reply, new Scanner(response.getData(), "UTF-8").useDelimiter("\\A").next());
    }
  }

  @Test public void readsABoundedBody() {
    Map<String,String> h=new HashMap<>(); h.put("content-length","15");
    assertEquals("{\"locked\":true}", LockdownRoute.readBody(h, new ByteArrayInputStream("{\"locked\":true}".getBytes())));
    h.put("content-length","5000"); assertNull(LockdownRoute.readBody(h, new ByteArrayInputStream(new byte[5000])));
    h.remove("content-length"); assertNull(LockdownRoute.readBody(h, new ByteArrayInputStream(new byte[0])));
  }
}
