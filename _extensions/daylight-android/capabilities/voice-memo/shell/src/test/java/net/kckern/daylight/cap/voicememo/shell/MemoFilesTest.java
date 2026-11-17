package net.kckern.daylight.cap.voicememo.shell;

import static org.junit.Assert.*;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.nio.file.Files;

public class MemoFilesTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    /** The payload's voice-memo capability reads this directory and serves this port (MemoInbox.DIR, VoiceMemoCapability.PORT). */
    @Test public void theInboxAndThePortAreTheOnesThePayloadUses() {
        assertEquals("memos/inbox", MemoFiles.INBOX);
        assertEquals("memos", MemoFiles.PORT);
        assertEquals("{\"op\":\"recorded\"}", MemoFiles.RECORDED);
    }

    @Test public void anIdIsItsStartTimeAndARandomTailAndIsWhatTheBackendAccepts() {
        String id = MemoFiles.newId(1_700_000_000_000L, 0xab12cd34L);
        assertEquals("1700000000000-ab12cd34", id);
        assertTrue(id.matches("[A-Za-z0-9_-]{1,64}"));
        assertEquals("1700000000000-00000001", MemoFiles.newId(1_700_000_000_000L, 1));
        assertTrue(MemoFiles.newId(System.currentTimeMillis(), -1L).matches("[0-9]{13}-[0-9a-f]{8}"));
    }

    @Test public void aRecordingIsWrittenAsPartAndRenamedWhenItIsWhole() throws Exception {
        File inbox = tmp.newFolder();
        File part = MemoFiles.part(inbox, "1700000000000-ab12cd34");
        assertEquals("1700000000000-ab12cd34.m4a.part", part.getName());
        Files.write(part.toPath(), new byte[10]);
        File done = MemoFiles.finish(part);
        assertEquals("1700000000000-ab12cd34.m4a", done.getName());
        assertTrue(done.isFile());
        assertFalse(part.exists());
        assertNull("a part that is gone finishes as nothing", MemoFiles.finish(part));
    }

    /** A .part file with no recorder writing it was cut off: it has no index and nothing can play it. */
    @Test public void whatAnEarlierRecorderLeftHalfWrittenIsRemoved() throws Exception {
        File inbox = tmp.newFolder();
        Files.write(new File(inbox, "1-a.m4a.part").toPath(), new byte[10]);
        Files.write(new File(inbox, "2-a.m4a.part").toPath(), new byte[10]);
        Files.write(new File(inbox, "3-a.m4a").toPath(), new byte[10]);
        assertEquals(2, MemoFiles.removeCutOff(inbox));
        assertTrue("a finished recording is never touched", new File(inbox, "3-a.m4a").isFile());
        assertEquals(0, MemoFiles.removeCutOff(inbox));
        assertEquals(0, MemoFiles.removeCutOff(new File(inbox, "absent")));
    }
}
