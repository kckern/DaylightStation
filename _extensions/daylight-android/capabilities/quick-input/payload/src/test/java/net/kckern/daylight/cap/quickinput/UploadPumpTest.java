package net.kckern.daylight.cap.quickinput;

import static org.junit.Assert.*;

import net.kckern.daylight.cap.quickinput.InputUploader.Outcome;
import net.kckern.daylight.cap.quickinput.InputUploader.Result;

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

    private InputQueue queueWith(String... ids) throws Exception {
        InputQueue q = new InputQueue(new File(tmp.newFolder(), "q.json"));
        for (String id : ids) {
            Files.write(audio(id).toPath(), new byte[8]);
            q.add(id, audio(id).getPath(), Long.parseLong(id.substring(0, id.indexOf('-'))));
        }
        return q;
    }

    private UploadPump pump(InputQueue q, Result... results) {
        final Deque<Result> script = new ArrayDeque<>(Arrays.asList(results));
        return new UploadPump(q, memo -> { sent.add(memo.id); return script.removeFirst(); }, () -> linkUp);
    }

    private static Result ok() { return new Result(Outcome.UPLOADED, ""); }

    @Test public void uploadsEverythingDueOneAtATimeAndDeletesEachFileAfterItsAcceptance() throws Exception {
        InputQueue q = queueWith("1000-a", "2000-a");
        UploadPump.Pass pass = pump(q, ok(), ok()).drain(5000);
        assertEquals(2, pass.uploaded);
        assertEquals("", pass.blocked);
        assertEquals(Arrays.asList("1000-a", "2000-a"), sent);
        assertEquals(0, q.waiting());
        assertFalse(audio("1000-a").exists());
        assertFalse(audio("2000-a").exists());
    }

    @Test public void stopsAtTheFirstFailureThatWillRepeatAndKeepsTheFiles() throws Exception {
        InputQueue q = queueWith("1000-a", "2000-a");
        assertEquals(0, pump(q, new Result(Outcome.NO_CONNECTION, "no connection")).drain(5000).uploaded);
        assertEquals("the second memo was not attempted", 1, sent.size());
        assertEquals(2, q.waiting());
        assertTrue(audio("1000-a").exists());
        assertEquals("the failed memo is backing off; the untried one is still due", "2000-a", q.claim(5000).id);
    }

    @Test public void aRejectedMemoIsParkedWithItsAudioAndTheNextOneStillGoes() throws Exception {
        InputQueue q = queueWith("1000-a", "2000-a");
        UploadPump.Pass pass = pump(q, new Result(Outcome.REJECTED, "HTTP 422 empty_transcription"), ok()).drain(5000);
        assertEquals(1, pass.uploaded);
        assertEquals(1, pass.parked);
        assertEquals(1, q.parked());
        assertTrue("a parked recording is kept", audio("1000-a").exists());
    }

    @Test public void withNoNetworkNothingIsTriedAndNothingIsCounted() throws Exception {
        linkUp = false;
        InputQueue q = queueWith("1000-a");
        UploadPump.Pass pass = pump(q).drain(5000);
        assertTrue(pass.offline);
        assertEquals(0, sent.size());
        assertEquals(0, q.describe().getJSONArray("inputs").getJSONObject(0).getInt("attempts"));
        assertTrue("due at once when the network returns", q.nextAttemptAtMs() <= 5000);
    }

    @Test public void withNoIdentityTheMemoGoesBackUntriedAndThePassSaysWhy() throws Exception {
        InputQueue q = queueWith("1000-a", "2000-a");
        UploadPump.Pass pass = pump(q, new Result(Outcome.BLOCKED, "identity not configured")).drain(5000);
        assertEquals("identity not configured", pass.blocked);
        assertEquals(1, sent.size());
        assertEquals(2, q.waiting());
        assertEquals(0, q.describe().getJSONArray("inputs").getJSONObject(0).getInt("attempts"));
        assertTrue(audio("1000-a").exists());
    }

    @Test public void theTwentiethAnsweredFailureParksTheMemoAndThePassSaysSo() throws Exception {
        InputQueue q = queueWith("1000-a");
        long now = 5000;
        UploadPump.Pass last = null;
        for (int i = 0; i < InputQueue.MAX_ATTEMPTS; i++) {
            last = pump(q, new Result(Outcome.RETRY, "HTTP 500 processing_failed")).drain(now);
            if (i < InputQueue.MAX_ATTEMPTS - 1) {
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
        InputQueue q = queueWith("1000-a");
        assertEquals(0, pump(q, new Result(Outcome.RETRY, "timeout")).drain(5000).uploaded);
        assertTrue("kept until a 200 arrives", audio("1000-a").exists());
        assertNull("backing off", q.claim(5001));
        assertEquals(1, pump(q, ok()).drain(q.nextAttemptAtMs()).uploaded);
        assertFalse(audio("1000-a").exists());
        assertEquals(1, q.describe().getInt("uploaded"));
    }

    @Test public void aRecordingThatIsGoneLeavesTheQueue() throws Exception {
        InputQueue q = queueWith("1000-a");
        UploadPump.Pass pass = pump(q, new Result(Outcome.LOST, "the recording is gone")).drain(5000);
        assertEquals(0, q.waiting());
        assertEquals(1, pass.lost);
    }

    /** Whatever the sender throws, the memo must not be left marked as out: nothing else would ever be sent. */
    @Test public void aSenderThatThrowsCountsAsAFailedAttemptAndTheQueueGoesOn() throws Exception {
        InputQueue q = queueWith("1000-a");
        UploadPump broken = new UploadPump(q, memo -> { throw new IllegalStateException("broke"); }, () -> true);
        assertEquals(0, broken.drain(5000).uploaded);
        assertEquals(1, q.describe().getJSONArray("inputs").getJSONObject(0).getInt("attempts"));
        assertEquals("QUEUED", q.describe().getJSONArray("inputs").getJSONObject(0).getString("state"));
        assertEquals(1, pump(q, ok()).drain(q.nextAttemptAtMs()).uploaded);
    }

    /** A swapped-out payload inside a long upload must leave the queue and the audio to its successor. */
    @Test public void aPumpStoppedWhileUploadingTouchesNothingAfterwards() throws Exception {
        final InputQueue q = queueWith("1000-a", "2000-a");
        final UploadPump[] holder = new UploadPump[1];
        holder[0] = new UploadPump(q, memo -> { holder[0].stop(); return ok(); }, () -> true);
        UploadPump.Pass pass = holder[0].drain(5000);
        assertEquals(0, pass.uploaded);
        assertTrue("the successor sends it again and is answered as a duplicate", audio("1000-a").exists());
        assertEquals(0, holder[0].drain(5000).uploaded);
    }

    // ── what counts toward parking, and what only waits ──────────────────────

    @Test public void daysWithoutTheVpnNeverParkAMemo() throws Exception {
        InputQueue q = queueWith("100-a");
        Result[] script = new Result[400];
        for (int i = 0; i < script.length; i++) {
            // A connect timeout, another network's gateway page, a redirect to a sign-in page.
            script[i] = i % 3 == 0 ? new Result(Outcome.NO_CONNECTION, "no connection")
                    : i % 3 == 1 ? new Result(Outcome.RETRY_UNCOUNTED, "HTTP 502") : new Result(Outcome.RETRY_UNCOUNTED, "HTTP 302");
        }
        UploadPump pump = pump(q, script);
        long now = 0;
        for (int i = 0; i < script.length; i++) {
            now += InputQueue.MAX_DELAY_MS;      // 400 hours
            assertEquals(0, pump.drain(now).parked);
        }
        assertEquals(0, q.parked());
        assertEquals(1, q.waiting());
        assertEquals(0, q.describe().getJSONArray("inputs").getJSONObject(0).getInt("attempts"));
        assertTrue(audio("100-a").exists());
    }

    @Test public void aPhoneNotYetAllowedWaitsWithoutCountingAndThePassSaysSo() throws Exception {
        InputQueue q = queueWith("100-a", "200-b");
        UploadPump.Pass pass = pump(q, new Result(Outcome.NOT_ALLOWED, "HTTP 403 device_not_allowed")).drain(1000);
        assertTrue(pass.notAllowed);
        assertEquals("the next memo would be answered the same way", 1, sent.size());
        assertEquals(0, q.describe().getJSONArray("inputs").getJSONObject(0).getInt("attempts"));
        assertEquals(1000 + InputQueue.BASE_DELAY_MS, q.describe().getJSONArray("inputs").getJSONObject(0).getLong("nextAttemptAtMs"));
    }

    @Test public void theDailyAllowanceHoldsTheWholeQueueUntilTheBackendsTime() throws Exception {
        InputQueue q = queueWith("100-a", "200-b");
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
        InputQueue q = new InputQueue(new File(tmp.newFolder(), "q.json"), bytes -> { if (full[0]) throw new java.io.IOException("full"); });
        Files.write(audio("100-a").toPath(), new byte[8]);
        q.add("100-a", audio("100-a").getPath(), 100);
        UploadPump pump = new UploadPump(q, memo -> { sent.add(memo.id); return ok(); }, () -> linkUp);
        full[0] = true;
        try { pump.drain(1000); fail("the pass went on with nothing written"); } catch (IllegalStateException expected) { }
        assertTrue(sent.isEmpty());
        full[0] = false;
        assertEquals(1, pump.drain(2000).uploaded);
    }
    // ── more than one destination ────────────────────────────────────────────

    private InputQueue mixed(String... idAndDest) throws Exception {
        InputQueue q = new InputQueue(new File(tmp.newFolder(), "q.json"));
        for (String pair : idAndDest) {
            String id = pair.substring(0, pair.indexOf('>'));
            Files.write(audio(id).toPath(), new byte[8]);
            q.add(id, audio(id).getPath(), Long.parseLong(id.substring(0, id.indexOf('-'))), pair.substring(pair.indexOf('>') + 1),
                    Destinations.Kind.VOICE);
        }
        return q;
    }

    /** A daily limit on one bot must not hold the other. */
    @Test public void aDailyAllowanceHoldsItsOwnDestinationAndTheOthersAreSentInTheSamePass() throws Exception {
        InputQueue q = mixed("100-a>journal", "200-b>meal", "300-c>journal", "400-d>meal");
        UploadPump pump = pump(q, new Result(Outcome.WAIT, "HTTP 429 daily_limit", 3_600_000L), ok(), ok(), ok(), ok());
        UploadPump.Pass pass = pump.drain(1000);
        assertEquals(Arrays.asList("100-a", "200-b", "400-d"), sent);
        assertEquals(2, pass.uploaded);
        assertEquals(java.util.Collections.singletonMap("journal", 1000 + 3_600_000L), pass.limits);
        assertEquals(1000 + 3_600_000L, pass.limitUntilMs);
        assertEquals(2, q.waiting());
        assertEquals(0, pump.drain(1000 + 3_599_999L).uploaded);
        assertEquals(2, pump.drain(1000 + 3_600_000L).uploaded);
    }

    @Test public void aDestinationThisPhoneIsNotAllowedForDoesNotStopTheOthers() throws Exception {
        InputQueue q = mixed("100-a>meal", "200-b>journal", "300-c>meal");
        UploadPump.Pass pass = pump(q, new Result(Outcome.NOT_ALLOWED, "HTTP 403 device_not_allowed"), ok()).drain(1000);
        assertEquals("the second meal input would be answered the same way and is not tried", Arrays.asList("100-a", "200-b"), sent);
        assertTrue(pass.notAllowed);
        assertEquals(java.util.Collections.singleton("meal"), pass.notAllowedDests);
        assertEquals(java.util.Collections.singleton("journal"), pass.uploadedDests);
        assertEquals(1, pass.uploaded);
        assertEquals(2, q.waiting());
    }

    @Test public void aFailureOfTheLinkStillEndsThePassForEveryDestination() throws Exception {
        InputQueue q = mixed("100-a>meal", "200-b>journal");
        pump(q, new Result(Outcome.NO_CONNECTION, "no connection")).drain(1000);
        assertEquals("with no connection the journal would fail the same way", 1, sent.size());
    }
    @Test public void anOfflineCaptureAndUncertainUploadSurviveReopeningUnderTheOriginalId() throws Exception {
        String owner = net.kckern.daylight.cap.quickinput.shell.CaptureScope.key("https://home.example", "alice");
        File directory = new File(tmp.getRoot(), "owner-" + owner);
        assertTrue(directory.mkdir());
        File file = new File(directory, "capture.journal.ogg");
        File state = new File(tmp.getRoot(), "state.json");
        Files.write(file.toPath(), new byte[] { 42 });
        InputQueue queue = new InputQueue(state);
        queue.add("capture", file.getPath(), 1000);
        linkUp = false;
        assertTrue(pump(queue).drain(1000).offline);
        assertEquals("QUEUED", queue.captureStatus(owner, 1000).getJSONObject(0).getString("state"));
        linkUp = true;
        pump(queue, new Result(Outcome.RETRY, "timeout")).drain(1000);
        assertTrue(file.exists());

        InputQueue restarted = new InputQueue(state);
        assertEquals("UNCERTAIN", restarted.captureStatus(owner, 1001).getJSONObject(0).getString("state"));
        assertFalse(restarted.retryCapture("capture", "another-owner", 1001));
        assertTrue(restarted.retryCapture("capture", owner, 1001));
        pump(restarted, new Result(Outcome.UPLOADED, "", 0, "memo:capture", null)).drain(1001);
        assertEquals(Arrays.asList("capture", "capture"), sent);
        assertFalse(file.exists());
        InputQueue finished = new InputQueue(state);
        assertEquals("memo:capture", finished.captureStatus(owner, 1002).getJSONObject(0).getString("entryId"));
        assertEquals("DELIVERED", finished.captureStatus(owner, 1002).getJSONObject(0).getString("state"));
        assertFalse(finished.retryCapture("capture", owner, 1002));
    }

    @Test public void captureFileSurvivesAnUnwritableReceiptAndThePumpCanRecover() throws Exception {
        File state = new File(tmp.getRoot(), "state.json");
        boolean[] receiptWriteFails = { false };
        InputQueue queue = new InputQueue(state, bytes -> {
            if (receiptWriteFails[0]) throw new java.io.IOException("Disk full");
            Files.write(state.toPath(), bytes);
        });
        String id = "capture";
        File file = audio(id);
        Files.write(file.toPath(), new byte[] { 42 });
        queue.add(id, file.getPath(), 1000);
        UploadPump pump = new UploadPump(queue, memo -> {
            sent.add(memo.id);
            receiptWriteFails[0] = sent.size() == 1;
            return ok();
        }, () -> true);
        assertThrows(IllegalStateException.class, () -> pump.drain(1000));
        assertTrue(file.exists());
        receiptWriteFails[0] = false;
        assertEquals(1, pump.drain(1000 + InputQueue.BASE_DELAY_MS).uploaded);
        assertEquals(Arrays.asList(id, id), sent);
        assertFalse(file.exists());
    }

}
