package net.kckern.daylight.cap.voicememo;

import static org.junit.Assert.*;

import net.kckern.daylight.cap.voicememo.MemoUploader.Outcome;
import net.kckern.daylight.cap.voicememo.MemoUploader.Result;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.nio.file.Files;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Deque;
import java.util.List;

public class UploadPumpTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();
    private boolean linkUp = true;
    private final List<String> sent = new ArrayList<>();

    private File audio(String id) { return new File(tmp.getRoot(), id + ".m4a"); }

    private MemoQueue queueWith(String... ids) throws Exception {
        MemoQueue q = new MemoQueue(new File(tmp.newFolder(), "q.json"));
        for (String id : ids) {
            Files.write(audio(id).toPath(), new byte[8]);
            q.add(id, audio(id).getPath(), Long.parseLong(id.substring(0, id.indexOf('-'))));
        }
        return q;
    }

    private UploadPump pump(MemoQueue q, Result... results) {
        final Deque<Result> script = new ArrayDeque<>(Arrays.asList(results));
        return new UploadPump(q, memo -> { sent.add(memo.id); return script.removeFirst(); }, () -> linkUp);
    }

    private static Result ok() { return new Result(Outcome.UPLOADED, ""); }

    @Test public void uploadsEverythingDueOneAtATimeAndDeletesEachFileAfterItsAcceptance() throws Exception {
        MemoQueue q = queueWith("1000-a", "2000-a");
        UploadPump.Pass pass = pump(q, ok(), ok()).drain(5000);
        assertEquals(2, pass.uploaded);
        assertEquals("", pass.blocked);
        assertEquals(Arrays.asList("1000-a", "2000-a"), sent);
        assertEquals(0, q.waiting());
        assertFalse(audio("1000-a").exists());
        assertFalse(audio("2000-a").exists());
    }

    @Test public void stopsAtTheFirstFailureThatWillRepeatAndKeepsTheFiles() throws Exception {
        MemoQueue q = queueWith("1000-a", "2000-a");
        assertEquals(0, pump(q, new Result(Outcome.NO_CONNECTION, "no connection")).drain(5000).uploaded);
        assertEquals("the second memo was not attempted", 1, sent.size());
        assertEquals(2, q.waiting());
        assertTrue(audio("1000-a").exists());
        assertEquals("the failed memo is backing off; the untried one is still due", "2000-a", q.claim(5000).id);
    }

    @Test public void aRejectedMemoIsParkedWithItsAudioAndTheNextOneStillGoes() throws Exception {
        MemoQueue q = queueWith("1000-a", "2000-a");
        UploadPump.Pass pass = pump(q, new Result(Outcome.REJECTED, "HTTP 422 empty_transcription"), ok()).drain(5000);
        assertEquals(1, pass.uploaded);
        assertEquals(1, pass.parked);
        assertEquals(1, q.parked());
        assertTrue("a parked recording is kept", audio("1000-a").exists());
    }

    @Test public void withNoNetworkNothingIsTriedAndNothingIsCounted() throws Exception {
        linkUp = false;
        MemoQueue q = queueWith("1000-a");
        UploadPump.Pass pass = pump(q).drain(5000);
        assertTrue(pass.offline);
        assertEquals(0, sent.size());
        assertEquals(0, q.describe().getJSONArray("memos").getJSONObject(0).getInt("attempts"));
        assertTrue("due at once when the network returns", q.nextAttemptAtMs() <= 5000);
    }

    @Test public void withNoIdentityTheMemoGoesBackUntriedAndThePassSaysWhy() throws Exception {
        MemoQueue q = queueWith("1000-a", "2000-a");
        UploadPump.Pass pass = pump(q, new Result(Outcome.BLOCKED, "identity not configured")).drain(5000);
        assertEquals("identity not configured", pass.blocked);
        assertEquals(1, sent.size());
        assertEquals(2, q.waiting());
        assertEquals(0, q.describe().getJSONArray("memos").getJSONObject(0).getInt("attempts"));
        assertTrue(audio("1000-a").exists());
    }

    @Test public void theTwentiethAnsweredFailureParksTheMemoAndThePassSaysSo() throws Exception {
        MemoQueue q = queueWith("1000-a");
        long now = 5000;
        UploadPump.Pass last = null;
        for (int i = 0; i < MemoQueue.MAX_ATTEMPTS; i++) {
            last = pump(q, new Result(Outcome.RETRY, "HTTP 500 processing_failed")).drain(now);
            if (i < MemoQueue.MAX_ATTEMPTS - 1) {
                assertEquals(0, last.parked);
                now = q.nextAttemptAtMs();
            }
        }
        assertEquals(1, last.parked);
        assertEquals(1, q.parked());
        assertTrue(audio("1000-a").exists());
    }

    /** The answer was lost (a timeout); the retry is answered as a duplicate, and only then is the audio removed. */
    @Test public void aTimeoutThenARetryThatIsADuplicateEndsWithTheAudioRemovedOnce() throws Exception {
        MemoQueue q = queueWith("1000-a");
        assertEquals(0, pump(q, new Result(Outcome.RETRY, "timeout")).drain(5000).uploaded);
        assertTrue("kept until a 200 arrives", audio("1000-a").exists());
        assertNull("backing off", q.claim(5001));
        assertEquals(1, pump(q, ok()).drain(q.nextAttemptAtMs()).uploaded);
        assertFalse(audio("1000-a").exists());
        assertEquals(1, q.describe().getInt("uploaded"));
    }

    @Test public void aRecordingThatIsGoneLeavesTheQueue() throws Exception {
        MemoQueue q = queueWith("1000-a");
        UploadPump.Pass pass = pump(q, new Result(Outcome.LOST, "the recording is gone")).drain(5000);
        assertEquals(0, q.waiting());
        assertEquals(1, pass.lost);
    }

    /** Whatever the sender throws, the memo must not be left marked as out: nothing else would ever be sent. */
    @Test public void aSenderThatThrowsCountsAsAFailedAttemptAndTheQueueGoesOn() throws Exception {
        MemoQueue q = queueWith("1000-a");
        UploadPump broken = new UploadPump(q, memo -> { throw new IllegalStateException("broke"); }, () -> true);
        assertEquals(0, broken.drain(5000).uploaded);
        assertEquals(1, q.describe().getJSONArray("memos").getJSONObject(0).getInt("attempts"));
        assertEquals("QUEUED", q.describe().getJSONArray("memos").getJSONObject(0).getString("state"));
        assertEquals(1, pump(q, ok()).drain(q.nextAttemptAtMs()).uploaded);
    }

    /** A swapped-out payload inside a long upload must leave the queue and the audio to its successor. */
    @Test public void aPumpStoppedWhileUploadingTouchesNothingAfterwards() throws Exception {
        final MemoQueue q = queueWith("1000-a", "2000-a");
        final UploadPump[] holder = new UploadPump[1];
        holder[0] = new UploadPump(q, memo -> { holder[0].stop(); return ok(); }, () -> true);
        UploadPump.Pass pass = holder[0].drain(5000);
        assertEquals(0, pass.uploaded);
        assertTrue("the successor sends it again and is answered as a duplicate", audio("1000-a").exists());
        assertEquals(0, holder[0].drain(5000).uploaded);
    }

    // ── what counts toward parking, and what only waits ──────────────────────

    @Test public void daysWithoutTheVpnNeverParkAMemo() throws Exception {
        MemoQueue q = queueWith("100-a");
        Result[] script = new Result[400];
        for (int i = 0; i < script.length; i++) {
            // A connect timeout, another network's gateway page, a redirect to a sign-in page.
            script[i] = i % 3 == 0 ? new Result(Outcome.NO_CONNECTION, "no connection")
                    : i % 3 == 1 ? new Result(Outcome.RETRY_UNCOUNTED, "HTTP 502") : new Result(Outcome.RETRY_UNCOUNTED, "HTTP 302");
        }
        UploadPump pump = pump(q, script);
        long now = 0;
        for (int i = 0; i < script.length; i++) {
            now += MemoQueue.MAX_DELAY_MS;      // 400 hours
            assertEquals(0, pump.drain(now).parked);
        }
        assertEquals(0, q.parked());
        assertEquals(1, q.waiting());
        assertEquals(0, q.describe().getJSONArray("memos").getJSONObject(0).getInt("attempts"));
        assertTrue(audio("100-a").exists());
    }

    @Test public void aPhoneNotYetAllowedWaitsWithoutCountingAndThePassSaysSo() throws Exception {
        MemoQueue q = queueWith("100-a", "200-b");
        UploadPump.Pass pass = pump(q, new Result(Outcome.NOT_ALLOWED, "HTTP 403 device_not_allowed")).drain(1000);
        assertTrue(pass.notAllowed);
        assertEquals("the next memo would be answered the same way", 1, sent.size());
        assertEquals(0, q.describe().getJSONArray("memos").getJSONObject(0).getInt("attempts"));
        assertEquals(1000 + MemoQueue.BASE_DELAY_MS, q.describe().getJSONArray("memos").getJSONObject(0).getLong("nextAttemptAtMs"));
    }

    @Test public void theDailyAllowanceHoldsTheWholeQueueUntilTheBackendsTime() throws Exception {
        MemoQueue q = queueWith("100-a", "200-b");
        UploadPump pump = pump(q, new Result(Outcome.WAIT, "HTTP 429 daily_limit", 7_200_000L), ok(), ok());
        UploadPump.Pass pass = pump.drain(1000);
        assertEquals(1000 + 7_200_000L, pass.limitUntilMs);
        assertEquals(1, sent.size());
        assertEquals(0, pump.drain(1000 + 7_199_999L).uploaded);
        assertEquals("nothing was tried in the meantime", 1, sent.size());
        assertEquals(2, pump.drain(1000 + 7_200_000L).uploaded);
        assertEquals(0, q.waiting() + q.parked());
    }

    @Test public void aQueueThatCannotBeWrittenFailsThePassAndTheNextOneSendsTheMemo() throws Exception {
        final boolean[] full = { false };
        MemoQueue q = new MemoQueue(new File(tmp.newFolder(), "q.json"), bytes -> { if (full[0]) throw new java.io.IOException("full"); });
        Files.write(audio("100-a").toPath(), new byte[8]);
        q.add("100-a", audio("100-a").getPath(), 100);
        UploadPump pump = new UploadPump(q, memo -> { sent.add(memo.id); return ok(); }, () -> linkUp);
        full[0] = true;
        try { pump.drain(1000); fail("the pass went on with nothing written"); } catch (IllegalStateException expected) { }
        assertTrue(sent.isEmpty());
        full[0] = false;
        assertEquals(1, pump.drain(2000).uploaded);
    }
}
