package net.kckern.daylight.cap.caractions.shell;

import static org.junit.Assert.*;

import org.junit.Test;

public class CarSessionKeyTest {
    /** The library writes a SessionInfo as "<display type>/<session id>" into the identifier (or the data path). */
    @Test public void readsTheKeyTheLibraryWrites() {
        CarSessionKey k = CarSessionKey.parse("0/main-session");
        assertEquals(0, k.displayType);
        assertEquals("main-session", k.sessionId);
        CarSessionKey cluster = CarSessionKey.parse("1/a/b");
        assertEquals(1, cluster.displayType);
        assertEquals("the session id is everything after the first divider", "a/b", cluster.sessionId);
        assertEquals("a data path may start with a slash", "x", CarSessionKey.parse("/0/x").sessionId);
    }

    @Test public void anythingElseIsNoKeyAndTheLibraryDefaultApplies() {
        for (String bad : new String[] { null, "", "main", "0/", "/", "x/abc", "2/abc", "-1/abc", "0/a\nb", "0/" + "a".repeat(200) }) {
            assertNull(bad, CarSessionKey.parse(bad));
        }
    }
}
