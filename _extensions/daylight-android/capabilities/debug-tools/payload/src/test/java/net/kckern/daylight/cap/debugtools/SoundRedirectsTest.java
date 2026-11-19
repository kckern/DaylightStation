package net.kckern.daylight.cap.debugtools;

import static org.junit.Assert.*;

import org.junit.Test;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class SoundRedirectsTest {
    private final Map<String, String> redirects = new HashMap<>();
    private final List<String> asked = new ArrayList<>();
    private final SoundRedirects.Probe probe = url -> { asked.add(url); return redirects.get(url); };
    private final SoundRedirects.Check trusted = url ->
            SoundPolicy.refusal(url, "https://kiosk.example/", "", "");

    @Test public void aUrlThatDoesNotRedirectIsPlayedAsItIs() throws Exception {
        assertEquals("https://kiosk.example/a.mp3", SoundRedirects.resolve("https://kiosk.example/a.mp3", probe, trusted));
        assertEquals(1, asked.size());
    }

    @Test public void redirectsWithinTheTrustedOriginsAreFollowedToTheEnd() throws Exception {
        redirects.put("https://kiosk.example/a.mp3", "https://kiosk.example/media/a.mp3");
        redirects.put("https://kiosk.example/media/a.mp3", "https://kiosk.example/cdn/a.mp3");
        assertEquals("https://kiosk.example/cdn/a.mp3", SoundRedirects.resolve("https://kiosk.example/a.mp3", probe, trusted));
    }

    @Test public void aRedirectToAnOriginTheKioskDoesNotTrustIsRefusedAndNeverFetched() throws Exception {
        redirects.put("https://kiosk.example/a.mp3", "https://elsewhere.example/a.mp3");
        try {
            SoundRedirects.resolve("https://kiosk.example/a.mp3", probe, trusted);
            fail("followed a redirect off the trusted origins");
        } catch (SoundRedirects.Refused e) {
            assertTrue(e.getMessage(), e.getMessage().startsWith("redirect 1 leaves the origins"));
        }
        assertEquals("the untrusted host was never contacted", java.util.Arrays.asList("https://kiosk.example/a.mp3"), asked);
    }

    @Test public void aRedirectToALocalAddressOrAnotherSchemeIsRefused() throws Exception {
        for (String target : new String[] { "http://192.0.2.7:8780/status", "file:///sdcard/x.mp3", "http://kiosk.example/a.mp3" }) {
            redirects.put("https://kiosk.example/a.mp3", target);
            try { SoundRedirects.resolve("https://kiosk.example/a.mp3", probe, trusted); fail("followed " + target); }
            catch (SoundRedirects.Refused expected) { }
        }
    }

    @Test public void atMostThreeRedirectsAreTaken() throws Exception {
        for (int i = 0; i < 10; i++) redirects.put("https://kiosk.example/" + i, "https://kiosk.example/" + (i + 1));
        try {
            SoundRedirects.resolve("https://kiosk.example/0", probe, trusted);
            fail("a redirect loop was followed");
        } catch (SoundRedirects.Refused e) {
            assertEquals("more than 3 redirects", e.getMessage());
        }
        assertEquals(SoundRedirects.MAX_HOPS + 1, asked.size());
        // Exactly three is fine.
        redirects.clear();
        asked.clear();
        for (int i = 0; i < 3; i++) redirects.put("https://kiosk.example/" + i, "https://kiosk.example/" + (i + 1));
        assertEquals("https://kiosk.example/3", SoundRedirects.resolve("https://kiosk.example/0", probe, trusted));
    }

    @Test public void theFirstUrlIsHeldToTheRuleToo() throws Exception {
        try { SoundRedirects.resolve("https://elsewhere.example/a.mp3", probe, trusted); fail(); }
        catch (SoundRedirects.Refused e) { assertFalse(e.getMessage().startsWith("redirect")); }
        assertTrue(asked.isEmpty());
    }
}
