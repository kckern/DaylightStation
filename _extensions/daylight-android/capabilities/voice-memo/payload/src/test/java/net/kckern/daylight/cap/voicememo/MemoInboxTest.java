package net.kckern.daylight.cap.voicememo;

import static org.junit.Assert.*;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.nio.file.Files;

public class MemoInboxTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    private static File file(File dir, String name, int bytes) throws Exception {
        File f = new File(dir, name);
        Files.write(f.toPath(), new byte[bytes]);
        return f;
    }

    /** The recorder in the shell half writes to this directory under the app's files (MemoFiles.INBOX there). */
    @Test public void theInboxIsWhereTheRecorderWrites() {
        assertEquals("memos/inbox", MemoInbox.DIR);
        assertEquals(".m4a", MemoInbox.SUFFIX);
    }

    @Test public void queuesFinishedRecordingsAndIgnoresOnesStillBeingWritten() throws Exception {
        File inbox = tmp.newFolder("inbox");
        File done = file(inbox, "1700000000000-ab12cd34.m4a", 10);
        file(inbox, "1700000005000-ab12cd34.m4a.part", 10);
        file(inbox, "notes.txt", 10);
        MemoQueue q = new MemoQueue(new File(tmp.newFolder(), "q.json"));
        assertEquals(1, MemoInbox.scan(inbox, q));
        assertEquals(0, MemoInbox.scan(inbox, q));
        MemoQueue.Memo m = q.claim(Long.MAX_VALUE);
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
        MemoQueue q = new MemoQueue(new File(tmp.newFolder(), "q.json"));
        assertEquals(0, MemoInbox.scan(inbox, q));
        assertTrue(new File(inbox, "my memo.m4a").exists());
    }

    @Test public void anEmptyRecordingIsRemovedAndNeverQueued() throws Exception {
        File inbox = tmp.newFolder("inbox");
        File empty = file(inbox, "1700000000000-ab12cd34.m4a", 0);
        MemoQueue q = new MemoQueue(new File(tmp.newFolder(), "q.json"));
        assertEquals(0, MemoInbox.scan(inbox, q));
        assertFalse(empty.exists());
    }

    @Test public void anIdWithNoTimeInItTakesTheFilesTime() throws Exception {
        File inbox = tmp.newFolder("inbox");
        File f = file(inbox, "memo_one.m4a", 10);
        assertTrue(f.setLastModified(1_600_000_000_000L));
        MemoQueue q = new MemoQueue(new File(tmp.newFolder(), "q.json"));
        MemoInbox.scan(inbox, q);
        assertEquals(1_600_000_000_000L, q.claim(Long.MAX_VALUE).recordedAtMs);
    }

    @Test public void aMissingInboxIsEmpty() throws Exception {
        MemoQueue q = new MemoQueue(new File(tmp.newFolder(), "q.json"));
        assertEquals(0, MemoInbox.scan(new File(tmp.getRoot(), "absent"), q));
        assertEquals(0, MemoInbox.sweepCutOff(new File(tmp.getRoot(), "absent"), 0));
    }

    /**
     * A recording that was cut off (the app was killed while recording) is a .part file
     * with no index, which nothing can play. It is removed once it is older than any
     * recording still under way can be.
     */
    @Test public void aRecordingThatWasCutOffIsRemovedOnceItCannotBeUnderWay() throws Exception {
        File inbox = tmp.newFolder("inbox");
        File old = file(inbox, "1700000000000-ab12cd34.m4a.part", 10);
        File live = file(inbox, "1700000009000-ab12cd34.m4a.part", 10);
        long now = 1_700_010_000_000L;
        assertTrue(old.setLastModified(now - MemoInbox.CUT_OFF_AFTER_MS - 1));
        assertTrue(live.setLastModified(now - 60_000));
        assertEquals(1, MemoInbox.sweepCutOff(inbox, now));
        assertFalse(old.exists());
        assertTrue("a recording under way is not touched", live.exists());
    }
}
