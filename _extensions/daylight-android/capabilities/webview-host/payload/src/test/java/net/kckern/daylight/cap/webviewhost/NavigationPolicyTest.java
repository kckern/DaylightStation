package net.kckern.daylight.cap.webviewhost;

import static org.junit.Assert.*;

import org.junit.Test;

public class NavigationPolicyTest {
    private static final String START = "https://kiosk.example/screen/piano";

    @Test public void byDefaultOnlyTheStartOriginMayLoadInTheMainFrame() {
        NavigationPolicy p = NavigationPolicy.of(START, "");
        assertTrue(p.allows(START));
        assertTrue(p.allows("https://kiosk.example/another/page?x=1#top"));
        assertFalse("an external link", p.allows("https://www.example.org/"));
        assertFalse("the same host over plain http is another origin", p.allows("http://kiosk.example/"));
        assertFalse("another port is another origin", p.allows("https://kiosk.example:8443/"));
        assertFalse(p.allows("https://kiosk.example.evil.example/"));
    }

    @Test public void aDeviceCanAddOrigins() {
        NavigationPolicy p = NavigationPolicy.of(START, "https://media.example, https://sso.example/login");
        assertTrue(p.allows("https://media.example/watch"));
        assertTrue("a URL in the list counts as its origin", p.allows("https://sso.example/other"));
        assertFalse(p.allows("https://www.example.org/"));
    }

    @Test public void thePhoneAddsItsLinkOriginsTheSameWay() {
        NavigationPolicy p = NavigationPolicy.of(START, "", "https://links.example");
        assertTrue(p.allows("https://links.example/feed"));
        NavigationPolicy none = NavigationPolicy.of(START, "", null);
        assertFalse(none.allows("https://links.example/feed"));
    }

    @Test public void whatHasNoHttpOriginIsNeverAllowed() {
        NavigationPolicy p = NavigationPolicy.of(START, "*");
        for (String bad : new String[] { null, "", "about:blank", "javascript:alert(1)", "file:///sdcard/x.html",
                "intent://x#Intent;end", "data:text/html,hi", "https://user@kiosk.example/" }) {
            assertFalse(String.valueOf(bad), p.allows(bad));
        }
        assertFalse("a wildcard is not an origin", p.allows("https://www.example.org/"));
    }

    @Test public void withNoStartUrlNothingIsAllowed() {
        assertFalse(NavigationPolicy.of("", "").allows("https://kiosk.example/"));
    }

    @Test public void aLogLineCarriesTheOriginAndNeverThePath() {
        assertEquals("https://www.example.org", NavigationPolicy.originForLog("https://www.example.org/reset?token=secret"));
        assertEquals("(no http origin)", NavigationPolicy.originForLog("intent://x"));
    }
}
