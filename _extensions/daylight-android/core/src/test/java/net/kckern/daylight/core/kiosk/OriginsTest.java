package net.kckern.daylight.core.kiosk;

import static org.junit.Assert.*;

import org.junit.Test;

public class OriginsTest {
    @Test public void anOriginIsSchemeHostAndANonDefaultPort() {
        assertEquals("https://kiosk.example", Origins.of("https://kiosk.example/piano?x=1#top"));
        assertEquals("https://kiosk.example", Origins.of("HTTPS://Kiosk.Example:443/"));
        assertEquals("http://192.0.2.7:8080", Origins.of("http://192.0.2.7:8080/a.mp3"));
        assertEquals("http://kiosk.example", Origins.of(" http://kiosk.example:80 "));
    }

    @Test public void anythingDoubtfulHasNoOrigin() {
        for (String bad : new String[] { null, "", "kiosk.example", "file:///sdcard/a.mp3", "content://media/1", "javascript:alert(1)",
                "https://", "https://user@kiosk.example/", "https://kiosk.example:99999/", "https://kiosk.example:/", "https://[::1]/",
                "https://kiosk.example\\@evil.example/", "ftp://kiosk.example/a", "https:/kiosk.example", "data:audio/mp3;base64,AAAA" }) {
            assertNull(String.valueOf(bad), Origins.of(bad));
        }
    }

    @Test public void aListIsCommaSeparatedAndSkipsWhatIsNotAnOrigin() {
        assertEquals(new java.util.LinkedHashSet<>(java.util.Arrays.asList("https://a.example", "http://b.example:8080")),
                Origins.list(" https://a.example/x , nonsense, http://b.example:8080 ,,"));
        assertTrue(Origins.list(null).isEmpty());
        assertTrue(Origins.list("").isEmpty());
    }
}
