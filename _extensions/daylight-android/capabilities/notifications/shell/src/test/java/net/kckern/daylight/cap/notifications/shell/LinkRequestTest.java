package net.kckern.daylight.cap.notifications.shell;

import static org.junit.Assert.*;

import org.json.JSONObject;
import org.junit.Test;

public class LinkRequestTest {
    private static final String VIEW = "android.intent.action.VIEW";

    @Test public void acceptsAViewOfADaylightOrWebLink() throws Exception {
        assertEquals("daylight://bookmark/feed", LinkRequest.accept(VIEW, "daylight://bookmark/feed"));
        assertEquals("https://kiosk.example/media", LinkRequest.accept(VIEW, "https://kiosk.example/media"));
        assertEquals("DAYLIGHT://open?path=/x", LinkRequest.accept(VIEW, "DAYLIGHT://open?path=/x"));
        assertEquals("daylight://bookmark/feed",
                new JSONObject(LinkRequest.body("daylight://bookmark/feed")).getString("uri"));
    }

    @Test public void dropsEverythingElseBeforeThePayloadIsAsked() {
        assertNull(LinkRequest.accept(VIEW, null));
        assertNull(LinkRequest.accept(VIEW, ""));
        assertNull(LinkRequest.accept(null, "daylight://bookmark/feed"));
        assertNull("only VIEW", LinkRequest.accept("android.intent.action.SEND", "daylight://bookmark/feed"));
        assertNull(LinkRequest.accept("android.intent.action.MAIN", "daylight://bookmark/feed"));
        for (String bad : new String[] { "intent://x#Intent;end", "file:///sdcard/x", "content://x/y", "javascript:alert(1)",
                "data:text/html,x", "about:blank", "daylight:open", "market://details?id=x", "daylight://" + "x".repeat(5000) }) {
            assertNull(bad, LinkRequest.accept(VIEW, bad));
        }
    }
}
