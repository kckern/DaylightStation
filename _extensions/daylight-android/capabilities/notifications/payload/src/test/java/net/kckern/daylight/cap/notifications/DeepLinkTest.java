package net.kckern.daylight.cap.notifications;

import static org.junit.Assert.*;

import org.junit.Test;

import java.util.Collections;
import java.util.Set;

public class DeepLinkTest {
    private static final String KEY = "0123456789abcdef0123456789abcdef";
    private static final Set<String> SITE = Collections.singleton("https://kiosk.example");
    private static final Set<String> NO_SITE = Collections.emptySet();

    private static DeepLink parse(String raw) { return DeepLink.parse(raw, SITE); }

    @Test public void parsesAnOpenLink() throws Exception {
        DeepLink l = parse("daylight://open?path=%2Fmedia%2Fchannels&x=a%20b");
        assertEquals("open", l.kind);
        assertEquals("", l.arg);
        assertEquals("/media/channels", l.query.get("path"));
        assertEquals("a b", l.query.get("x"));
        assertFalse(l.needsKey());
        assertTrue(l.authorized(null));
    }

    @Test public void parsesTheArgumentAfterTheKind() {
        assertEquals("feed", parse("daylight://bookmark/feed").arg);
        assertEquals("play", parse("daylight://media/play?id=plex:123").arg);
        assertEquals("plex:123", parse("daylight://media/play?id=plex:123").query.get("id"));
    }

    @Test public void actionsAndMemosNeedTheInstallKey() {
        DeepLink bare = parse("daylight://action/lights-off");
        assertTrue(bare.needsKey());
        assertFalse(bare.authorized(KEY));
        assertFalse(parse("daylight://action/lights-off?k=wrong").authorized(KEY));
        assertTrue(parse("daylight://action/lights-off?k=" + KEY).authorized(KEY));
        assertTrue(parse("daylight://memo/new?k=" + KEY).authorized(KEY));
        assertFalse("no key on this install means nothing keyed is allowed",
                parse("daylight://memo/new?k=").authorized(""));
        assertFalse(parse("daylight://memo/new?k=short").authorized("short"));
    }

    @Test public void theKeyNeverTravelsOnToTheHandler() {
        DeepLink l = parse("daylight://action/lights-off?k=" + KEY + "&dim=1");
        assertEquals("lights-off", l.arg);
        assertEquals("1", l.handlerQuery().get("dim"));
        assertFalse(l.handlerQuery().containsKey("k"));
    }

    @Test public void refusesOtherSchemesAndUnknownKinds() {
        for (String bad : new String[] { null, "", "daylight:open", "daylight://settings/x", "daylight://",
                "intent://open#Intent;end", "daylight://open?path=%ZZ", "file:///sdcard/x", "content://x/y",
                "javascript:alert(1)", "data:text/html,x", "about:blank", "daylight://user@open?path=/x",
                "daylight://open:8080?path=/x", "daylight://open?path=/x#" + "y".repeat(5000) }) {
            try { parse(bad); fail("accepted " + bad); } catch (IllegalArgumentException expected) { }
        }
    }

    @Test public void aRefusalNeverRepeatsWhatTheLinkSaid() {
        // The reason goes into a log that leaves the device; a link can hold a key or anything a stranger typed.
        try {
            parse("daylight://s3cr3t-kind/x?k=" + KEY);
            fail("accepted");
        } catch (IllegalArgumentException e) {
            assertFalse(e.getMessage(), e.getMessage().contains("s3cr3t"));
            assertFalse(e.getMessage(), e.getMessage().contains(KEY));
        }
    }

    @Test public void theSchemeAndKindAreNotCaseSensitive() {
        assertEquals("open", parse("DAYLIGHT://Open?path=/x").kind);
    }

    @Test public void aLinkOfTheHouseholdSiteIsAnOpenLinkForItsPath() {
        DeepLink l = parse("https://kiosk.example/media/channels?tab=recent#top");
        assertEquals("open", l.kind);
        assertEquals("/media/channels?tab=recent#top", l.query.get("path"));
        assertFalse(l.needsKey());
        assertEquals("/", parse("https://kiosk.example").query.get("path"));
        assertEquals("/", parse("HTTPS://KIOSK.EXAMPLE/").query.get("path"));
    }

    @Test public void aWebLinkOnAnyOtherOriginIsRefused() {
        for (String bad : new String[] { "https://evil.example/media", "https://kiosk.example.evil.example/",
                "https://kiosk.example@evil.example/", "https://evil.example/?u=https://kiosk.example/",
                "http://kiosk.example/media", "https://kiosk.example:8443/media", "https://kiosk.example\\@evil.example/",
                "https:///media", "https://", "https:kiosk.example" }) {
            try { parse(bad); fail("accepted " + bad); } catch (IllegalArgumentException expected) { }
        }
        try { DeepLink.parse("https://kiosk.example/media", NO_SITE); fail("accepted with no site configured"); }
        catch (IllegalArgumentException expected) { }
    }
}
