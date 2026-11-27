package net.kckern.daylight.cap.notifications.shell;

import static org.junit.Assert.*;

import org.junit.Test;

public class LinkLabelTest {
    @Test public void anActionIsNamedByItsId() {
        assertEquals("Lights off", LinkLabel.of("daylight://action/lights-off"));
        assertEquals("your shortcut", LinkLabel.of("daylight://action/"));
    }

    @Test public void capturesAndPagesSayWhatTheyAre() {
        assertEquals("voice memo", LinkLabel.of("daylight://input/voice?x=1"));
        assertEquals("photo", LinkLabel.of("daylight://input/photo"));
        assertEquals("opening Feed", LinkLabel.of("daylight://bookmark/feed"));
        assertEquals("starting your music", LinkLabel.of("daylight://media/play?id=c:1"));
        assertEquals("opening the link", LinkLabel.of("https://example.org/x"));
    }

    @Test public void anythingElseIsYourTap() {
        assertEquals("your tap", LinkLabel.of("daylight://"));
        assertEquals("your tap", LinkLabel.of(null));
        assertEquals("your tap", LinkLabel.of("mailto:x"));
    }

    @Test public void longNamesAreCut() {
        assertTrue(LinkLabel.of("daylight://action/" + "a".repeat(80)).length() <= 40);
    }
}
