package net.kckern.daylight.cap.notifications;

import static org.junit.Assert.*;

import net.kckern.daylight.core.spi.LocalNotices;

import org.junit.Test;

public class NoticeTest {
    private static final String KEY = "0123456789abcdef0123456789abcdef";

    private static Notice notice(String id, String channel, String title, String text, String uri) {
        return Notice.of(id, channel, title, text, uri, KEY);
    }

    private static String message(String id, String channel, String title, String text, String uri) {
        try { notice(id, channel, title, text, uri); } catch (IllegalArgumentException e) { return e.getMessage(); }
        fail("expected IllegalArgumentException");
        return null;
    }

    @Test public void readsANoticeAndGivesItAStableAndroidId() {
        Notice n = notice("memo-queue", "uploads", "Voice memos", "2 waiting", "");
        assertEquals("memo-queue", n.id);
        assertEquals("uploads", n.channel);
        assertEquals("daylight_uploads", n.androidChannel());
        assertEquals("", n.uri);
        assertEquals(n.androidId(), notice("memo-queue", "uploads", "Voice memos", "3 waiting", "").androidId());
        assertEquals(n.androidId(), Notice.androidId("memo-queue"));
        assertTrue("clear of the shell's and the recorder's ids", n.androidId() >= 1000);
        assertNotEquals(n.androidId(), notice("other", "uploads", "Voice memos", "", "").androidId());
    }

    @Test public void rejectsWhatItCannotPost() {
        assertTrue(message("Memo Queue", "uploads", "t", "", "").contains("id"));
        assertTrue(message(null, "uploads", "t", "", "").contains("id"));
        assertEquals("unknown channel", message("x", "alarms", "t", "", ""));
        assertTrue(message("x", "uploads", "", "", "").contains("title"));
        assertTrue(message("x", "uploads", null, "", "").contains("title"));
        StringBuilder longTitle = new StringBuilder();
        for (int i = 0; i < 81; i++) longTitle.append('a');
        assertTrue(message("x", "uploads", longTitle.toString(), "", "").contains("title"));
    }

    @Test public void aLongTextIsCutAndAMissingOneIsEmpty() {
        StringBuilder text = new StringBuilder();
        for (int i = 0; i < 400; i++) text.append('a');
        assertEquals(300, notice("x", "general", "t", text.toString(), "").text.length());
        assertEquals("", notice("x", "general", "t", null, null).text);
    }

    @Test public void aTapTargetMustBeOneOfThisAppsLinks() {
        assertEquals("daylight://open?path=/feed", notice("x", "general", "t", "", "daylight://open?path=/feed").uri);
        for (String bad : new String[] { "https://kiosk.example/", "intent:#Intent;end", "daylight://nope/x", "javascript:alert(1)", "daylight:" }) {
            assertEquals(bad, "a notice opens only this app's own links", message("x", "general", "t", "", bad));
        }
    }

    /** The app posts the notice itself, so a tap on it may carry the install key. */
    @Test public void aLinkThatNeedsTheKeyIsGivenIt() {
        assertEquals("daylight://memo/queue#k=" + KEY, notice("x", "uploads", "t", "", "daylight://memo/queue").uri);
        assertEquals("daylight://action/x?dim=1#k=" + KEY, notice("x", "uploads", "t", "", "daylight://action/x?dim=1").uri);
        assertEquals("a link that already carries it is left alone", "daylight://memo/new#k=" + KEY,
                notice("x", "uploads", "t", "", "daylight://memo/new#k=" + KEY).uri);
        assertEquals("a page link needs none", "daylight://bookmark/feed", notice("x", "uploads", "t", "", "daylight://bookmark/feed").uri);
        assertEquals("with no key yet the link is posted as it is, and a tap is refused", "daylight://memo/queue",
                Notice.of("x", "uploads", "t", "", "daylight://memo/queue", "").uri);
    }

    @Test public void aNoticeMayCarryOneActionThatOpensOneOfTheAppsOwnLinks() {
        String key = "0123456789abcdef0123456789abcdef";
        Notice n = Notice.of("memo-queue", LocalNotices.UPLOADS, "Voice memos", "1 could not be sent", "daylight://memo/queue",
                "Discard", "daylight://memo/discard", key);
        assertEquals("Discard", n.actionLabel);
        assertTrue("the action is a keyed link like the tap", n.actionUri.startsWith("daylight://memo/discard") && n.actionUri.contains(key));
        Notice plain = Notice.of("memo-queue", LocalNotices.UPLOADS, "Voice memos", "1 waiting", "daylight://memo/queue", key);
        assertEquals("", plain.actionLabel);
        assertEquals("", plain.actionUri);
        for (String[] bad : new String[][] { { "Discard", "" }, { "", "daylight://memo/discard" }, { "Discard", "https://evil.example/" },
                { "A label that is far too long for a button", "daylight://memo/discard" } }) {
            try {
                Notice.of("memo-queue", LocalNotices.UPLOADS, "Voice memos", "x", "", bad[0], bad[1], key);
                fail("accepted " + bad[0] + " / " + bad[1]);
            } catch (IllegalArgumentException expected) { }
        }
    }
}
