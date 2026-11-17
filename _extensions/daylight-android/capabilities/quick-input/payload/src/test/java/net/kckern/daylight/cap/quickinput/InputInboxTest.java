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
        InputQueue.Memo m = q.claim(Long.MAX_VALUE);
        assertEquals("1700000000000-ab12cd34", m.id);
        assertEquals(1700000000000L, m.recordedAtMs);
        assertEquals(done.getPath(), m.file);
    }

    /** The backend takes an id of letters, digits, '_' and '-', at most 64. */
    @Test public void aFileWhoseNameIsNotAMemoIdIsLeftAlone() throws Exception {
        File inbox = tmp.newFolder("inbox");
        file(inbox, "my memo.m4a", 10);
        file(inbox, "a.b.m4a", 10);
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
        InputQueue.Memo m = q.claim(Long.MAX_VALUE);
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
        InputQueue.Memo first = q.claim(Long.MAX_VALUE);
        assertEquals("1700000000000-ab12cd34-00", first.id);
        assertEquals(1700000000000L, first.recordedAtMs);
        q.uploaded(first.id);
        InputQueue.Memo second = q.claim(Long.MAX_VALUE);
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
}
