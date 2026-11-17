package net.kckern.daylight.cap.webviewhost;

import static org.junit.Assert.*;

import org.junit.Test;

public class OriginPolicyTest {
    @Test public void originIsSchemeHostAndNonDefaultPort() {
        assertEquals("https://app.example.test", OriginPolicy.originOf("https://App.Example.test/piano?device=x#h"));
        assertEquals("https://app.example.test", OriginPolicy.originOf("https://app.example.test:443/"));
        assertEquals("http://app.example.test:3111", OriginPolicy.originOf("http://app.example.test:3111"));
        assertEquals("http://192.0.2.10", OriginPolicy.originOf("http://192.0.2.10:80/x"));
        assertEquals("a query the URI class would reject still has an origin",
                "https://app.example.test", OriginPolicy.originOf("https://app.example.test/p?q={a|b} c"));
    }

    @Test public void anythingDoubtfulHasNoOrigin() {
        for (String bad : new String[] { null, "", "about:blank", "data:text/html,x", "file:///sdcard/x.html",
                "javascript:alert(1)", "intent://x#Intent;end", "https://", "https:///path",
                "https://user@app.example.test/", "https://app.example.test\\@evil.test/",
                "https://app.example.test:99999/", "https://app.example.test:8a/", "https://exa mple.test/" }) {
            assertNull("expected no origin for " + bad, OriginPolicy.originOf(bad));
        }
    }

    @Test public void theDefaultAllowedOriginIsTheStartUrls() {
        OriginPolicy p = OriginPolicy.fromSettings("", "https://app.example.test/piano?device=piano");
        assertTrue(p.allows("https://app.example.test/other/page"));
        assertFalse(p.allows("http://app.example.test/other/page"));
        assertFalse(p.allows("https://app.example.test.evil.test/"));
        assertFalse(p.allows("about:blank"));
    }

    @Test public void configuredOriginsReplaceTheDefault() {
        OriginPolicy p = OriginPolicy.fromSettings(" https://a.test , http://b.test:3111/ignored-path ", "https://start.test/");
        assertTrue(p.allows("https://a.test/x"));
        assertTrue(p.allows("http://b.test:3111/y"));
        assertFalse(p.allows("https://start.test/"));
        assertEquals(new java.util.LinkedHashSet<>(java.util.Arrays.asList("https://a.test", "http://b.test:3111")), p.rules());
    }

    @Test public void noStartUrlAndNoListAllowsNothing() {
        assertFalse(OriginPolicy.fromSettings("", "").allows("https://a.test/"));
    }
}
