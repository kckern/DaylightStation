package net.kckern.portalkeys.payload;
import org.junit.Test;
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
  @Test public void readsABoundedBody() {
    java.util.Map<String,String> h=new java.util.HashMap<>(); h.put("content-length","15");
    assertEquals("{\"locked\":true}", LockdownRoute.readBody(h, new java.io.ByteArrayInputStream("{\"locked\":true}".getBytes())));
    h.put("content-length","5000"); assertNull(LockdownRoute.readBody(h, new java.io.ByteArrayInputStream(new byte[5000])));
    h.remove("content-length"); assertNull(LockdownRoute.readBody(h, new java.io.ByteArrayInputStream(new byte[0])));
  }
}
