package net.kckern.daylight.cap.quickinput;

import static org.junit.Assert.*;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.nio.file.Files;

public class InputInboxTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    private static File file(File dir, String name, int bytes) throws Exception {
        File f = new File(dir, name);
        Files.write(f.toPath(), new byte[bytes]);
        return f;
    }

    /** The recorder in the shell half writes to this directory under the app's files (MemoFiles.INBOX there). */
    @Test public void theInboxIsWhereTheRecorderWrites() {
        assertEquals("memos/inbox", InputInbox.DIR);
        assertEquals("memos/cutoff", InputInbox.CUT_OFF_DIR);
        assertArrayEquals(new String[] { ".ogg", ".m4a" }, InputInbox.SUFFIXES);
    }

    @Test public void queuesFinishedRecordingsAndIgnoresOnesStillBeingWritten() throws Exception {
        File inbox = tmp.newFolder("inbox");
        File done = file(inbox, "1700000000000-ab12cd34.m4a", 10);
        file(inbox, "1700000005000-ab12cd34.m4a.part", 10);
        file(inbox, "notes.txt", 10);
        InputQueue q = new InputQueue(new File(tmp.newFolder(), "q.json"));
        assertEquals(1, InputInbox.scan(inbox, q));
        assertEquals(0, InputInbox.scan(inbox, q));
        InputQueue.Entry m = q.claim(Long.MAX_VALUE);
        assertEquals("1700000000000-ab12cd34", m.id);
        assertEquals(1700000000000L, m.recordedAtMs);
        assertEquals(done.getPath(), m.file);
    }

    /** The backend takes an id of letters, digits, '_' and '-', at most 64. */
    @Test public void aFileWhoseNameIsNotAMemoIdIsLeftAlone() throws Exception {
        File inbox = tmp.newFolder("inbox");
        file(inbox, "my memo.m4a", 10);
        file(inbox, "a.B.m4a", 10);
        file(inbox, "a.b.c.m4a", 10);
        StringBuilder longName = new StringBuilder();
        for (int i = 0; i < 65; i++) longName.append('a');
        file(inbox, longName + ".m4a", 10);
        InputQueue q = new InputQueue(new File(tmp.newFolder(), "q.json"));
        assertEquals(0, InputInbox.scan(inbox, q));
        assertTrue(new File(inbox, "my memo.m4a").exists());
    }

    @Test public void anEmptyRecordingIsRemovedAndNeverQueued() throws Exception {
        File inbox = tmp.newFolder("inbox");
        File empty = file(inbox, "1700000000000-ab12cd34.m4a", 0);
        InputQueue q = new InputQueue(new File(tmp.newFolder(), "q.json"));
        assertEquals(0, InputInbox.scan(inbox, q));
        assertFalse(empty.exists());
    }

    @Test public void anIdWithNoTimeInItTakesTheFilesTime() throws Exception {
        File inbox = tmp.newFolder("inbox");
        File f = file(inbox, "memo_one.m4a", 10);
        assertTrue(f.setLastModified(1_600_000_000_000L));
        InputQueue q = new InputQueue(new File(tmp.newFolder(), "q.json"));
        InputInbox.scan(inbox, q);
        assertEquals(1_600_000_000_000L, q.claim(Long.MAX_VALUE).recordedAtMs);
    }

    @Test public void aMissingInboxIsEmpty() throws Exception {
        InputQueue q = new InputQueue(new File(tmp.newFolder(), "q.json"));
        assertEquals(0, InputInbox.scan(new File(tmp.getRoot(), "absent"), q));
        assertEquals(0, InputInbox.cutOffKept(new File(tmp.getRoot(), "absent")));
    }

    @Test public void anOggMemoIsQueuedWithTheStartTimeInItsId() throws Exception {
        File inbox = tmp.newFolder("inbox");
        File ogg = file(inbox, "1700000000000-ab12cd34.ogg", 10);
        InputQueue q = new InputQueue(new File(tmp.newFolder(), "q.json"));
        assertEquals(1, InputInbox.scan(inbox, q));
        InputQueue.Entry m = q.claim(Long.MAX_VALUE);
        assertEquals("1700000000000-ab12cd34", m.id);
        assertEquals("when the recording started, not when the file was found", 1700000000000L, m.recordedAtMs);
        assertEquals(ogg.getPath(), m.file);
    }

    /** Android 8 and 9: each five-minute segment is a memo of its own, in order, with its own start. */
    @Test public void aSegmentIsAMemoOfItsOwnWithItsOwnStartTime() throws Exception {
        File inbox = tmp.newFolder("inbox");
        file(inbox, "1700000000000-ab12cd34-00@1700000000000.m4a", 10);
        file(inbox, "1700000000000-ab12cd34-01@1700000300500.m4a", 10);
        InputQueue q = new InputQueue(new File(tmp.newFolder(), "q.json"));
        assertEquals(2, InputInbox.scan(inbox, q));
        InputQueue.Entry first = q.claim(Long.MAX_VALUE);
        assertEquals("1700000000000-ab12cd34-00", first.id);
        assertEquals(1700000000000L, first.recordedAtMs);
        q.uploaded(first.id);
        InputQueue.Entry second = q.claim(Long.MAX_VALUE);
        assertEquals("1700000000000-ab12cd34-01", second.id);
        assertEquals("the segment's own start, so the journal orders them", 1700000300500L, second.recordedAtMs);
        assertTrue(second.id.matches(InputInbox.ID.pattern()));
    }

    /** A recording that was cut off is the installed recorder's to recover. Nothing here removes one. */
    @Test public void aRecordingStillBeingWrittenOrCutOffIsNeverRemovedHere() throws Exception {
        File inbox = tmp.newFolder("inbox");
        File old = file(inbox, "1700000000000-ab12cd34.m4a.part", 10);
        File ogg = file(inbox, "1700000009000-ab12cd34.ogg.part", 10);
        assertTrue(old.setLastModified(1L));
        InputQueue q = new InputQueue(new File(tmp.newFolder(), "q.json"));
        assertEquals(0, InputInbox.scan(inbox, q));
        assertTrue(old.exists());
        assertTrue(ogg.exists());
        File cutOff = tmp.newFolder("cutoff");
        file(cutOff, "1700000000000-ab12cd34-02.m4a", 10);
        assertEquals(1, InputInbox.cutOffKept(cutOff));
    }
    // ── kind and destination, from the name ──────────────────────────────────

    @Test public void theOtherInboxIsWhereTextAndPhotosAreWritten() {
        assertEquals("inputs/inbox", InputInbox.INPUTS_DIR);
    }

    @Test public void aRecordingNamedForADestinationIsQueuedForIt() throws Exception {
        File inbox = tmp.newFolder("inbox");
        file(inbox, "1700000000000-ab12cd34.meal.ogg", 10);
        file(inbox, "1700000001000-ab12cd34-00.meal@1700000001500.m4a", 10);
        InputQueue q = new InputQueue(new File(tmp.newFolder(), "q.json"));
        assertEquals(2, InputInbox.scan(inbox, q));
        InputQueue.Entry whole = q.claim(Long.MAX_VALUE);
        assertEquals("1700000000000-ab12cd34", whole.id);
        assertEquals("meal", whole.dest);
        assertEquals(Destinations.Kind.VOICE, whole.kind);
        assertEquals("audio/ogg", whole.contentType);
        q.uploaded(whole.id);
        InputQueue.Entry segment = q.claim(Long.MAX_VALUE);
        assertEquals("1700000001000-ab12cd34-00", segment.id);
        assertEquals("meal", segment.dest);
        assertEquals(1700000001500L, segment.recordedAtMs);
        assertEquals("audio/mp4", segment.contentType);
    }

    @Test public void aRecordingWithNoDestinationInItsNameIsTheJournals() throws Exception {
        File inbox = tmp.newFolder("inbox");
        file(inbox, "1700000000000-ab12cd34.ogg", 10);
        InputQueue q = new InputQueue(new File(tmp.newFolder(), "q.json"));
        InputInbox.scan(inbox, q);
        assertEquals("journal", q.claim(Long.MAX_VALUE).dest);
    }

    @Test public void textAndPhotosAreQueuedByTheirNames() throws Exception {
        File inbox = tmp.newFolder("inputs");
        File note = file(inbox, "1700000000000-ab12cd34.journal-note.txt", 12);
        File photo = file(inbox, "1700000002000-ab12cd34.meal-photo.jpg", 400);
        InputQueue q = new InputQueue(new File(tmp.newFolder(), "q.json"));
        assertEquals(2, InputInbox.scan(inbox, q));
        InputQueue.Entry first = q.claim(Long.MAX_VALUE);
        assertEquals(Destinations.Kind.TEXT, first.kind);
        assertEquals("journal-note", first.dest);
        assertEquals("text/plain; charset=utf-8", first.contentType);
        assertEquals(1700000000000L, first.recordedAtMs);
        assertEquals(note.getPath(), first.file);
        q.uploaded(first.id);
        InputQueue.Entry second = q.claim(Long.MAX_VALUE);
        assertEquals(Destinations.Kind.PHOTO, second.kind);
        assertEquals("meal-photo", second.dest);
        assertEquals("image/jpeg", second.contentType);
        assertEquals(photo.getPath(), second.file);
    }

    /** Only a recording can do without a destination: that is what a memo from an earlier build looks like. */
    @Test public void textOrAPhotoWithNoDestinationInItsNameIsLeftAlone() throws Exception {
        File inbox = tmp.newFolder("inputs");
        File a = file(inbox, "1700000000000-ab12cd34.txt", 12);
        File b = file(inbox, "1700000000000-ab12cd35.jpg", 12);
        File c = file(inbox, "1700000000000-ab12cd36.Meal.jpg", 12);
        InputQueue q = new InputQueue(new File(tmp.newFolder(), "q.json"));
        assertEquals(0, InputInbox.scan(inbox, q));
        assertTrue(a.exists() && b.exists() && c.exists());
    }

    @Test public void whatIsStillBeingWrittenOrCapturedIsNotQueued() throws Exception {
        File inbox = tmp.newFolder("inputs");
        file(inbox, "1700000000000-ab12cd34.journal-note.txt.part", 12);
        file(inbox, "1700000000000-ab12cd35.meal-photo.jpg.part", 12);
        file(inbox, "1700000000000-ab12cd36.meal-photo.raw.part", 12);
        InputQueue q = new InputQueue(new File(tmp.newFolder(), "q.json"));
        assertEquals(0, InputInbox.scan(inbox, q));
        assertEquals(3, inbox.listFiles().length);
    }
    /**
     * A capture whose screen was killed leaves a .part file: a photo as the camera wrote
     * it, with where it was taken in it. It is removed once it is plainly nobody's, at a
     * pass of the queue, so it does not wait for the next time a screen is opened.
     */
    @Test public void aStalePartFileInTheInputsInboxIsRemovedAndNothingElseIs() throws Exception {
        File inbox = tmp.newFolder("inputs");
        long now = 1_700_000_000_000L;
        File fresh = file(inbox, "1700000000000-ab12cd34.meal-photo.raw.part", 10);
        File stale = file(inbox, "1690000000000-ab12cd34.meal-photo.raw.part", 10);
        File finished = file(inbox, "1690000000000-ab12cd35.meal-photo.jpg", 10);
        assertTrue(fresh.setLastModified(now - 60_000));
        assertTrue(stale.setLastModified(now - InputInbox.STALE_PART_MS - 1));
        assertTrue(finished.setLastModified(1L));
        assertEquals(1, InputInbox.sweepParts(inbox, now));
        assertTrue(fresh.exists());
        assertFalse(stale.exists());
        assertTrue(finished.exists());
        assertEquals(0, InputInbox.sweepParts(new File(inbox, "absent"), now));
        assertEquals("the same age the screens use (CaptureFiles.STALE_MS)", 30 * 60_000L, InputInbox.STALE_PART_MS);
    }
}
