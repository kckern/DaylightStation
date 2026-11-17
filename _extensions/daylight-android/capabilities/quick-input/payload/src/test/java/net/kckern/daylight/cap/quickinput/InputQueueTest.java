package net.kckern.daylight.cap.quickinput;

import static org.junit.Assert.*;

import net.kckern.daylight.cap.quickinput.InputQueue.Memo;
import net.kckern.daylight.cap.quickinput.InputQueue.State;

import org.json.JSONObject;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

public class InputQueueTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();
    private File state;

    @Before public void setUp() throws Exception { state = new File(tmp.newFolder(), "memo-queue.json"); }

    @Test public void addingTheSameMemoTwiceQueuesItOnce() {
        InputQueue q = new InputQueue(state);
        assertTrue(q.add("1000-a", "/inbox/1000-a.m4a", 1000));
        assertFalse(q.add("1000-a", "/inbox/1000-a.m4a", 1000));
        assertEquals(1, q.waiting());
    }

    @Test public void claimTakesTheOldestDueMemoAndMarksItUploading() {
        InputQueue q = new InputQueue(state);
        q.add("2000-a", "/inbox/2000-a.m4a", 2000);
        q.add("1000-a", "/inbox/1000-a.m4a", 1000);
        Memo first = q.claim(5000);
        assertEquals("1000-a", first.id);
        assertEquals(State.UPLOADING, first.state);
        assertNull("one upload at a time: nothing else is claimed while one is out", q.claim(5000));
        q.uploaded("1000-a");
        assertEquals("2000-a", q.claim(5000).id);
        q.uploaded("2000-a");
        assertNull(q.claim(5000));
    }

    @Test public void aFailureWaitsLongerEachTimeUpToAnHour() {
        InputQueue q = new InputQueue(state);
        q.add("1000-a", "/inbox/1000-a.m4a", 1000);
        long now = 10_000;
        long[] expected = { 5_000, 10_000, 20_000, 40_000 };
        for (long wait : expected) {
            assertNotNull(q.claim(now));
            assertFalse(q.retryLater("1000-a", "no connection", false, now));
            assertEquals(now + wait, q.nextAttemptAtMs());
            assertNull("not due yet", q.claim(now + wait - 1));
            now += wait;
        }
        // Failures that never reached the backend do not count toward the limit, however many.
        for (int i = 0; i < 60; i++) { q.claim(now); q.retryLater("1000-a", "no connection", false, now); now = q.nextAttemptAtMs(); }
        q.claim(now);
        q.retryLater("1000-a", "no connection", false, now);
        assertEquals(now + 3_600_000, q.nextAttemptAtMs());
        assertEquals(0, q.parked());
        assertEquals(1, q.waiting());
    }

    @Test public void afterTwentyAttemptsTheBackendAnsweredTheMemoIsParked() throws Exception {
        InputQueue q = new InputQueue(state);
        q.add("1000-a", "/inbox/1000-a.m4a", 1000);
        long now = 10_000;
        for (int attempt = 1; attempt < InputQueue.MAX_ATTEMPTS; attempt++) {
            assertNotNull("attempt " + attempt, q.claim(now));
            assertFalse(q.retryLater("1000-a", "HTTP 500", true, now));
            now = q.nextAttemptAtMs();
        }
        assertNotNull(q.claim(now));
        assertTrue("the twentieth parks it", q.retryLater("1000-a", "HTTP 500", true, now));
        assertEquals(1, q.parked());
        assertEquals(0, q.waiting());
        assertNull(q.claim(Long.MAX_VALUE));
        JSONObject memo = q.describe().getJSONArray("memos").getJSONObject(0);
        assertEquals("PARKED", memo.getString("state"));
        assertEquals(20, memo.getInt("attempts"));
        assertEquals("HTTP 500", memo.getString("lastError"));
        assertEquals("parked survives a restart", 1, new InputQueue(state).parked());
    }

    @Test public void aRefusalParksTheMemoAtOnceWithItsReason() throws Exception {
        InputQueue q = new InputQueue(state);
        q.add("1000-a", "/inbox/1000-a.m4a", 1000);
        q.claim(5000);
        q.park("1000-a", "HTTP 422 empty_transcription");
        assertEquals(0, q.waiting());
        assertEquals(1, q.parked());
        assertNull(q.claim(999_999_999));
        assertEquals(-1, q.nextAttemptAtMs());
        assertEquals("HTTP 422 empty_transcription", q.describe().getJSONArray("memos").getJSONObject(0).getString("lastError"));
    }

    @Test public void retryAllMakesWaitingAndParkedMemosDueNowWithAFreshCount() throws Exception {
        InputQueue q = new InputQueue(state);
        q.add("1000-a", "/inbox/1000-a.m4a", 1000);
        q.add("2000-a", "/inbox/2000-a.m4a", 2000);
        q.claim(5000); q.park("1000-a", "HTTP 422");
        q.claim(5000); q.retryLater("2000-a", "no connection", false, 5000);
        q.retryAll(6000);
        assertEquals(2, q.waiting());
        assertEquals(0, q.parked());
        Memo again = q.claim(6000);
        assertEquals("1000-a", again.id);
        assertEquals(0, again.attempts);
        q.uploaded("1000-a");
        assertEquals("2000-a", q.claim(6000).id);
    }

    @Test public void aMemoHandedBackUntriedIsDueAtOnceAndCostsNoAttempt() {
        InputQueue q = new InputQueue(state);
        q.add("1000-a", "/inbox/1000-a.m4a", 1000);
        q.claim(5000);
        q.release("1000-a");
        Memo again = q.claim(5000);
        assertEquals(0, again.attempts);
        assertEquals(State.UPLOADING, again.state);
    }

    @Test public void theQueueSurvivesARestartAndAnInterruptedUploadIsQueuedAgain() {
        InputQueue q = new InputQueue(state);
        q.add("1000-a", "/inbox/1000-a.m4a", 1000);
        q.add("2000-a", "/inbox/2000-a.m4a", 2000);
        q.claim(5000);                                  // 1000-a is UPLOADING when the process dies
        InputQueue restarted = new InputQueue(state);
        assertEquals(2, restarted.waiting());
        assertEquals("the backend answers a repeat of the same id as a duplicate, so it is sent again", "1000-a", restarted.claim(5000).id);
    }

    @Test public void anUploadedMemoLeavesTheQueueAndIsCounted() throws Exception {
        InputQueue q = new InputQueue(state);
        q.add("1000-a", "/inbox/1000-a.m4a", 1000);
        q.claim(5000);
        q.uploaded("1000-a");
        assertEquals(0, q.waiting());
        assertEquals(1, new InputQueue(state).describe().getInt("uploaded"));
    }

    @Test public void aMemoWhoseRecordingIsGoneIsDroppedAndCounted() throws Exception {
        InputQueue q = new InputQueue(state);
        q.add("1000-a", "/inbox/1000-a.m4a", 1000);
        q.claim(5000);
        q.lost("1000-a");
        assertEquals(0, q.waiting());
        assertEquals(0, q.parked());
        assertEquals(1, q.describe().getInt("lost"));
    }

    @Test public void aCorruptStateFileStartsAnEmptyQueue() throws Exception {
        Files.write(state.toPath(), "{not json".getBytes(StandardCharsets.UTF_8));
        assertEquals(0, new InputQueue(state).waiting());
        Files.write(state.toPath(), "{\"memos\":[{\"id\":\"1000-a\"},7,{\"id\":\"2000-a\",\"file\":\"/x\",\"state\":\"NOPE\"}]}".getBytes(StandardCharsets.UTF_8));
        assertEquals("an entry that cannot be read is left out; the recording is still in the inbox", 0, new InputQueue(state).waiting());
    }

    /** A payload that was swapped out can still be inside a five-minute upload. */
    @Test public void aClosedQueueWritesNothingMore() throws Exception {
        InputQueue old = new InputQueue(state);
        old.add("1000-a", "/inbox/1000-a.m4a", 1000);
        old.claim(5000);
        old.close();
        InputQueue successor = new InputQueue(state);
        successor.add("2000-a", "/inbox/2000-a.m4a", 2000);
        old.uploaded("1000-a");
        old.add("3000-a", "/inbox/3000-a.m4a", 3000);
        assertEquals("the successor's file is as the successor left it", 2, new InputQueue(state).waiting());
    }

    @Test public void theDescriptionHoldsStatesAndCountsAndNoPathOutsideTheInbox() throws Exception {
        InputQueue q = new InputQueue(state);
        q.add("1000-a", "/data/user/0/app/files/memos/inbox/1000-a.m4a", 1000);
        JSONObject d = q.describe();
        assertEquals(1, d.getInt("waiting"));
        assertEquals(0, d.getInt("parked"));
        assertFalse("ids, states and counts only", d.toString().contains("/data/"));
    }

    // ── a change that cannot be written is undone ────────────────────────────

    /** A disk that is full for a while. */
    private static final class Disk implements InputQueue.Store {
        boolean full;
        int writes;
        @Override public void write(byte[] bytes) throws Exception {
            if (full) throw new java.io.IOException("No space left on device");
            writes++;
        }
    }

    private static void failing(Runnable change) {
        try { change.run(); fail("the change was reported as made"); } catch (IllegalStateException expected) { }
    }

    @Test public void aClaimThatCannotBeWrittenLeavesTheInputQueuedSoTheNextPassTakesIt() {
        Disk disk = new Disk();
        final InputQueue q = new InputQueue(state, disk);
        q.add("100-a", "/x/100-a.ogg", 100);
        disk.full = true;
        failing(() -> q.claim(1000));
        // Before: the memo stayed UPLOADING in memory and every later claim answered null.
        failing(() -> q.claim(2000));
        disk.full = false;
        Memo m = q.claim(3000);
        assertNotNull("the queue is not stuck", m);
        assertEquals("100-a", m.id);
        assertEquals(State.UPLOADING, m.state);
    }

    @Test public void aRetryThatCannotBeWrittenIsNotCountedTwiceAndTheMemoStaysOut() {
        Disk disk = new Disk();
        final InputQueue q = new InputQueue(state, disk);
        q.add("100-a", "/x/100-a.ogg", 100);
        q.claim(1000);
        disk.full = true;
        failing(() -> q.retryLater("100-a", "HTTP 500 processing_failed", true, 1000));
        disk.full = false;
        assertFalse(q.retryLater("100-a", "HTTP 500 processing_failed", true, 1000));
        Memo m = q.claim(1000 + InputQueue.BASE_DELAY_MS);
        assertEquals("one failure was written, so one is counted", 1, m.attempts);
    }

    @Test public void aParkThatCannotBeWrittenLeavesTheMemoAsItWas() throws Exception {
        Disk disk = new Disk();
        final InputQueue q = new InputQueue(state, disk);
        q.add("100-a", "/x/100-a.ogg", 100);
        q.claim(1000);
        disk.full = true;
        failing(() -> q.park("100-a", "HTTP 422 empty_transcription"));
        assertEquals(0, q.parked());
        assertEquals(1, q.waiting());
        disk.full = false;
        q.park("100-a", "HTTP 422 empty_transcription");
        assertEquals(1, q.parked());
        assertEquals("PARKED", q.describe().getJSONArray("memos").getJSONObject(0).getString("state"));
    }

    // ── the daily allowance holds the whole queue ────────────────────────────

    @Test public void aHeldQueueSendsNothingBeforeItsTimeWhoeverAsks() {
        InputQueue q = new InputQueue(state);
        q.add("100-a", "/x/100-a.ogg", 100);
        q.add("200-b", "/x/200-b.ogg", 200);
        assertEquals("100-a", q.claim(1000).id);
        q.holdUntil("100-a", "HTTP 429 daily_limit", 1000 + 7_200_000L);
        assertNull(q.claim(2000));
        q.retryAll(3000);                       // the owner tapped "try again"
        assertNull("the backend said when; a tap does not change that", q.claim(4000));
        assertEquals(1000 + 7_200_000L, q.nextAttemptAtMs());
        assertEquals(1000 + 7_200_000L, q.holdUntilMs(4000));
        assertEquals(0, q.holdUntilMs(1000 + 7_200_000L));
        Memo m = q.claim(1000 + 7_200_000L);
        assertEquals("100-a", m.id);
        assertEquals("waiting for the allowance is not an attempt", 0, m.attempts);
        // And it survives a restart.
        InputQueue held = new InputQueue(state);
        held.holdUntil("100-a", "HTTP 429 daily_limit", 9_000_000_000L);
        assertNull(new InputQueue(state).claim(8_000_000_000L));
    }

    // ── discarding what could not be sent ────────────────────────────────────

    @Test public void discardingRemovesParkedMemosOnlyAndSaysWhichFilesToDelete() throws Exception {
        InputQueue q = new InputQueue(state);
        q.add("100-a", "/x/100-a.ogg", 100);
        q.add("200-b", "/x/200-b.ogg", 200);
        q.claim(1000);
        q.park("100-a", "HTTP 422 empty_transcription");
        assertEquals(java.util.Collections.singletonList("/x/100-a.ogg"), q.discardParked());
        assertEquals(0, q.parked());
        assertEquals("a memo that is only waiting is never discarded", 1, q.waiting());
        assertEquals(1, q.describe().getInt("discarded"));
        assertTrue(q.discardParked().isEmpty());
        assertEquals(1, new InputQueue(state).describe().getInt("discarded"));
    }
}
