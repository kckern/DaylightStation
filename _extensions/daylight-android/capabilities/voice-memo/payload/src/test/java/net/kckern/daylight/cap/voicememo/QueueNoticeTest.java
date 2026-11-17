package net.kckern.daylight.cap.voicememo;

import static org.junit.Assert.*;

import org.junit.Test;

public class QueueNoticeTest {
    @Test public void withNothingLeftThereIsNoNotice() {
        assertNull(QueueNotice.of(0, 0, ""));
        assertNull("with nothing kept there is nothing to say about the identity either", QueueNotice.of(0, 0, "identity not configured"));
    }

    @Test public void waitingMemosAreCounted() {
        QueueNotice one = QueueNotice.of(1, 0, "");
        assertEquals("Voice memos", one.title);
        assertEquals("1 voice memo waiting to upload", one.text);
        assertEquals("daylight://memo/queue", one.link);
        assertEquals("3 voice memos waiting to upload", QueueNotice.of(3, 0, "").text);
    }

    @Test public void parkedMemosSayWhatATapDoes() {
        assertEquals("1 voice memo could not be sent. Tap to try again.", QueueNotice.of(0, 1, "").text);
        assertEquals("2 voice memos could not be sent. Tap to try again.", QueueNotice.of(0, 2, "").text);
        assertEquals("2 voice memos could not be sent, 1 waiting. Tap to try again.", QueueNotice.of(1, 2, "").text);
    }

    @Test public void aMissingIdentityIsSaidInThoseWordsAndComesFirst() {
        QueueNotice n = QueueNotice.of(2, 1, "identity not configured");
        assertEquals("Voice memos are not set up", n.title);
        assertEquals("identity not configured. 3 voice memos are kept on this phone.", n.text);
        assertEquals("1 voice memo is kept on this phone.", QueueNotice.of(1, 0, "identity not configured").text.substring("identity not configured. ".length()));
    }

    @Test public void theSameStateIsTheSameNotice() {
        assertEquals(QueueNotice.of(2, 1, "").key(), QueueNotice.of(2, 1, "").key());
        assertNotEquals(QueueNotice.of(2, 1, "").key(), QueueNotice.of(3, 1, "").key());
    }

    @Test public void parkedMemosCanBeDiscardedFromTheNotice() {
        QueueNotice n = QueueNotice.of(0, 2, "");
        assertEquals("Discard", n.actionLabel);
        assertEquals("daylight://memo/discard", n.actionLink);
        assertEquals("a waiting memo has no such button", "", QueueNotice.of(2, 0, "").actionLabel);
    }

    @Test public void aPhoneNotYetAllowedIsSaidInThoseWords() {
        QueueNotice n = QueueNotice.of(1, 0, "", true, 0);
        assertTrue(n.text, n.text.startsWith("This phone is not allowed to send memos yet."));
        assertTrue(n.text, n.text.contains("1 voice memo is kept"));
        assertEquals("", n.actionLabel);
    }

    @Test public void theDailyAllowanceSaysWhenSendingResumes() {
        long at = 1_700_000_000_000L;
        QueueNotice n = QueueNotice.of(3, 0, "", false, at);
        assertTrue(n.text, n.text.startsWith("The daily allowance for voice memos is used up. Sending resumes at about " + QueueNotice.clock(at)));
        assertTrue(n.text, n.text.endsWith("3 voice memos waiting."));
        assertTrue(QueueNotice.clock(at), QueueNotice.clock(at).matches("[A-Z][a-z]{2} \\d\\d:\\d\\d"));
        assertNotEquals("a new time is a new notice", n.key(), QueueNotice.of(3, 0, "", false, at + 3_600_000L).key());
    }
}
