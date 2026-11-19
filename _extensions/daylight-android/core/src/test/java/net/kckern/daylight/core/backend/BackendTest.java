package net.kckern.daylight.core.backend;

import static org.junit.Assert.*;

import net.kckern.daylight.core.SettingsRegistry;
import net.kckern.daylight.core.SettingsRegistry.Type;

import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;

public class BackendTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();
    private SettingsRegistry settings;

    @Before public void setUp() throws Exception {
        settings = new SettingsRegistry(new File(tmp.newFolder(), "overrides.json"));
    }

    private Backend backend() { return Backend.from(settings, "phone"); }

    private static String message(Runnable r) {
        try { r.run(); } catch (RuntimeException e) { return e.getMessage(); }
        fail("expected an exception");
        return null;
    }

    @Test public void usesTheExplicitBaseUrlWithoutItsPath() {
        Backend b = backend();
        settings.set(Backend.BASE_URL, "https://kiosk.example:3111/ignored");
        assertEquals("https://kiosk.example:3111", b.baseUrl());
        assertEquals("https://kiosk.example:3111/api/v1/list/", b.url("/api/v1/list/"));
    }

    @Test public void fallsBackToTheOriginOfTheStartUrl() {
        settings.declare("webview.startUrl", Type.STRING, "https://kiosk.example/feed?x=1");
        assertEquals("https://kiosk.example", backend().baseUrl());
    }

    @Test public void failsWhenNothingIsConfigured() {
        Backend b = backend();
        assertTrue(message(b::baseUrl).contains("backend not configured"));
        assertFalse(b.configured());
    }

    @Test public void aBaseUrlThatIsNotAnHttpUrlIsRefusedWhenItIsSet() {
        backend();
        for (String bad : new String[] { "{phone_backend_url}", "kiosk.example", "ftp://kiosk.example", "javascript:alert(1)" }) {
            assertTrue(bad, message(() -> settings.set(Backend.BASE_URL, bad)).contains("not an http(s) URL"));
        }
    }

    @Test public void aStartUrlThatIsNotAnHttpUrlIsNamedWhenTheBaseIsAskedFor() {
        settings.declare("webview.startUrl", Type.STRING, "{phone_start_url}");
        assertTrue(message(backend()::baseUrl).contains("not an http(s) URL"));
    }

    @Test public void urlAcceptsOnlyASingleSlashPath() {
        Backend b = backend();
        settings.set(Backend.BASE_URL, "https://kiosk.example");
        for (String bad : new String[] { null, "", "media", "//evil.example/x", "https://evil.example/", "/a\\b", "/a\nb", "/\\evil.example" }) {
            try { b.url(bad); fail("accepted " + bad); } catch (IllegalArgumentException expected) { }
        }
    }

    @Test public void absoluteResolvesRelativeRefsAndRefusesOtherHosts() {
        Backend b = backend();
        settings.set(Backend.BASE_URL, "https://kiosk.example");
        assertEquals("https://kiosk.example/api/v1/proxy/plex/thumb/1", b.absolute("/api/v1/proxy/plex/thumb/1"));
        assertEquals("https://kiosk.example/x", b.absolute("https://kiosk.example/x"));
        assertNull(b.absolute("https://evil.example/x"));
        assertNull("a host that only starts like the backend", b.absolute("https://kiosk.example.evil.example/x"));
        assertNull(b.absolute("https://kiosk.example@evil.example/x"));
        assertNull(b.absolute("//evil.example/x"));
        assertNull(b.absolute(""));
        assertNull(b.absolute(null));
    }

    @Test public void theDeviceHeaderDefaultsToTheFleetId() {
        Backend b = backend();
        assertEquals("fleet:phone", b.deviceHeader());
        settings.set(Backend.DEVICE, "browser:abc123");
        assertEquals("browser:abc123", b.deviceHeader());
    }

    @Test public void aDeviceHeaderTheBackendWouldRefuseIsRefusedWhenItIsSet() {
        backend();
        for (String bad : new String[] { "phone", "fleet:", "other:x", "fleet:a b", "browser:a\nb" }) {
            assertTrue(bad, message(() -> settings.set(Backend.DEVICE, bad)).contains("identity.device"));
        }
    }

    @Test public void aSecondCapabilityCanAskForTheBackendToo() {
        backend();
        Backend second = backend();
        settings.set(Backend.USER, "example-user");
        assertEquals("example-user", second.user());
    }

    @Test public void theUserIsANameAndNothingElse() {
        backend();
        for (String bad : new String[] { "a b", "a&b=c", "a/b", "a?b", "x".repeat(65) }) {
            assertTrue(bad, message(() -> settings.set(Backend.USER, bad)).contains("identity.user"));
        }
    }

    // ── pages a link may open ─────────────────────────────────────────────────

    @Test public void aPagePathIsAPlainPathWithAnOptionalQueryAndFragment() {
        for (String ok : new String[] { "/", "/feed", "/media/channels", "/media?tab=recent&x=a%20b", "/call#room", "/a.b/c_d-e~f/" }) {
            assertEquals(ok, Backend.pagePath(ok));
        }
    }

    @Test public void aPagePathNeverReachesTheApi() {
        // A daylight://open link can be fired by any web page or app on the phone, and the
        // backend trusts the phone by its address. A link must not be a way to make the
        // app send a request to an API route.
        for (String bad : new String[] { "/api", "/api/", "/api/v1/home/scenes/all-off", "/API/v1/x", "/Api/x",
                "/%61pi/v1/x", "/./api/v1/x", "/x/../api/v1/x", "/x/%2e%2e/api/v1/x", "/api?x=1", "/api#x", "/;/api/v1" }) {
            try { Backend.pagePath(bad); fail("accepted " + bad); } catch (IllegalArgumentException expected) { }
        }
    }

    @Test public void aPagePathIsNeverAnotherHostOrAnotherScheme() {
        for (String bad : new String[] { null, "", "feed", "//evil.example/", "/\\evil.example", "https://evil.example/",
                "javascript:alert(1)", "intent://x#Intent;end", "file:///etc/hosts", "content://x", "/a b", "/a\nb",
                "/a/../b", "/a/./b", "/a//b", "/feed?x=<script>", "/feed?x=\"", "/" + "x".repeat(2100) }) {
            try { Backend.pagePath(bad); fail("accepted " + bad); } catch (IllegalArgumentException expected) { }
        }
    }
}
