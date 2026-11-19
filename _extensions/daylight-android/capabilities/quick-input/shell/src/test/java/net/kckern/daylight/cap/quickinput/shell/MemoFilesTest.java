package net.kckern.daylight.cap.quickinput.shell;

import static org.junit.Assert.*;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.nio.file.Files;

public class MemoFilesTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    /** The payload's quick-input capability reads this directory and serves this port (InputInbox.DIR, QuickInputCapability.PORT). */
    @Test public void theInboxAndThePortAreTheOnesThePayloadUses() {
        assertEquals("memos/inbox", MemoFiles.INBOX);
        assertEquals("inputs", MemoFiles.PORT);
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
        File part = MemoFiles.part(inbox, "1700000000000-ab12cd34", MemoFiles.OGG);
        assertEquals("1700000000000-ab12cd34.ogg.part", part.getName());
        Files.write(part.toPath(), new byte[10]);
        File done = MemoFiles.finish(part);
        assertEquals("1700000000000-ab12cd34.ogg", done.getName());
        assertTrue(done.isFile());
        assertFalse(part.exists());
        assertNull("a part that is gone finishes as nothing", MemoFiles.finish(part));
    }

    /** Android 8 and 9: a segment is a memo of its own, and its file says when it started. */
    @Test public void aSegmentIsNamedForItsMemoItsNumberAndItsOwnStart() throws Exception {
        File inbox = tmp.newFolder();
        assertEquals("1700000000000-ab12cd34-00", MemoFiles.segmentId("1700000000000-ab12cd34", 0));
        assertEquals("1700000000000-ab12cd34-05", MemoFiles.segmentId("1700000000000-ab12cd34", 5));
        assertTrue("still an id the backend accepts", MemoFiles.segmentId("1700000000000-ab12cd34", 5).matches("[A-Za-z0-9_-]{1,64}"));
        File part = MemoFiles.part(inbox, MemoFiles.segmentId("1700000000000-ab12cd34", 1), MemoFiles.M4A);
        assertEquals("1700000000000-ab12cd34-01.m4a.part", part.getName());
        Files.write(part.toPath(), new byte[10]);
        File done = MemoFiles.finishSegment(part, 1_700_000_300_500L);
        assertEquals("1700000000000-ab12cd34-01@1700000300500.m4a", done.getName());
        assertNull(MemoFiles.finishSegment(part, 1));
        assertEquals("memos/cutoff", MemoFiles.CUT_OFF);
    }

    // ── a recording that was cut off is never deleted ────────────────────────

    private static File write(File dir, String name, int bytes) throws Exception {
        File f = new File(dir, name);
        Files.write(f.toPath(), new byte[bytes]);
        return f;
    }

    @Test public void aCutOffOggRecordingBecomesAMemoWithTheStartTimeInItsName() throws Exception {
        File inbox = tmp.newFolder(), cutOff = new File(tmp.getRoot(), "cutoff");
        write(inbox, "1700000000000-ab12cd34.ogg.part", 60_000);
        MemoRecovery.Found found = MemoRecovery.recover(inbox, cutOff, null);
        assertEquals(1, found.recovered);
        assertEquals(0, found.unplayable);
        assertTrue("Ogg plays up to where it stops", new File(inbox, "1700000000000-ab12cd34.ogg").isFile());
        assertFalse(new File(inbox, "1700000000000-ab12cd34.ogg.part").exists());
    }

    @Test public void aCutOffMp4HasNoIndexSoItIsKeptAsideAndNotQueued() throws Exception {
        File inbox = tmp.newFolder(), cutOff = new File(tmp.getRoot(), "cutoff");
        write(inbox, "1700000000000-ab12cd34-02.m4a.part", 60_000);
        write(inbox, "1700000000000-ab12cd34-01@1700000300000.m4a", 60_000);
        MemoRecovery.Found found = MemoRecovery.recover(inbox, cutOff, null);
        assertEquals(0, found.recovered);
        assertEquals(1, found.unplayable);
        assertTrue("kept, never deleted", new File(cutOff, "1700000000000-ab12cd34-02.m4a").isFile());
        assertEquals(60_000, new File(cutOff, "1700000000000-ab12cd34-02.m4a").length());
        assertTrue("a finished segment is not touched", new File(inbox, "1700000000000-ab12cd34-01@1700000300000.m4a").isFile());
        assertEquals(1, inbox.listFiles().length);
    }

    @Test public void theRecordingUnderWayIsLeftAlone() throws Exception {
        File inbox = tmp.newFolder(), cutOff = new File(tmp.getRoot(), "cutoff");
        File live = write(inbox, "1700000009000-ab12cd34.ogg.part", 60_000);
        File liveSegment = write(inbox, "1700000009000-ab12cd34-03.m4a.part", 60_000);
        write(inbox, "1700000000000-ffffffff.ogg.part", 60_000);
        MemoRecovery.Found found = MemoRecovery.recover(inbox, cutOff, "1700000009000-ab12cd34");
        assertEquals(1, found.recovered);
        assertEquals(0, found.unplayable);
        assertTrue(live.isFile());
        assertTrue(liveSegment.isFile());
    }

    @Test public void anOggFileTooShortToHoldSoundIsKeptAsideAndAnEmptyFileIsRemoved() throws Exception {
        File inbox = tmp.newFolder(), cutOff = new File(tmp.getRoot(), "cutoff");
        write(inbox, "1700000000000-ab12cd34.ogg.part", (int) MemoRecovery.MIN_OGG_BYTES - 1);
        write(inbox, "1700000001000-ab12cd34.ogg.part", 0);
        MemoRecovery.Found found = MemoRecovery.recover(inbox, cutOff, null);
        assertEquals(0, found.recovered);
        assertEquals(1, found.unplayable);
        assertTrue(new File(cutOff, "1700000000000-ab12cd34.ogg").isFile());
        assertEquals("nothing was captured in the empty one", 0, inbox.listFiles().length);
        assertEquals(0, MemoRecovery.recover(new File(inbox, "absent"), cutOff, null).recovered);
    }

    @Test public void thePayloadsRecoveryLeavesTheLiveRecordingAlone() throws Exception {
        File files = tmp.newFolder();
        File inbox = new File(files, MemoFiles.INBOX);
        assertTrue(inbox.mkdirs());
        write(inbox, "1700000009000-ab12cd34.ogg.part", 60_000);
        MemoRecovery.live("1700000009000-ab12cd34");
        try {
            assertEquals(0, MemoRecovery.recoverNow(files).recovered);
        } finally {
            MemoRecovery.live(null);
        }
        assertEquals("once its recorder is gone it is recovered", 1, MemoRecovery.recoverNow(files).recovered);
    }
    // ── a recording for a destination ────────────────────────────────────────

    /** The payload reads the destination from the name (InputInbox): "<id>.<dest>.ogg", "<id>-<nn>.<dest>@<start>.m4a". */
    @Test public void aRecordingForADestinationCarriesItsIdInTheName() throws Exception {
        File inbox = tmp.newFolder();
        assertEquals("1700000000000-ab12cd34.meal", MemoFiles.stem("1700000000000-ab12cd34", "meal"));
        assertEquals("with no destination the name is the one an earlier build wrote", "1700000000000-ab12cd34",
                MemoFiles.stem("1700000000000-ab12cd34", null));
        File part = MemoFiles.part(inbox, MemoFiles.stem("1700000000000-ab12cd34", "meal"), MemoFiles.OGG);
        assertEquals("1700000000000-ab12cd34.meal.ogg.part", part.getName());
        Files.write(part.toPath(), new byte[10]);
        assertEquals("1700000000000-ab12cd34.meal.ogg", MemoFiles.finish(part).getName());
        File segment = MemoFiles.part(inbox, MemoFiles.stem(MemoFiles.segmentId("1700000000000-ab12cd34", 0), "meal"), MemoFiles.M4A);
        assertEquals("1700000000000-ab12cd34-00.meal.m4a.part", segment.getName());
        Files.write(segment.toPath(), new byte[10]);
        assertEquals("1700000000000-ab12cd34-00.meal@1700000000500.m4a", MemoFiles.finishSegment(segment, 1_700_000_000_500L).getName());
    }

    /** What arrives in an intent is text: a destination is an id of the settled shape, or it is not one. */
    @Test public void aDestinationFromAnIntentIsAnIdOrNothing() {
        assertEquals("meal", MemoFiles.dest("meal"));
        assertEquals("journal-note", MemoFiles.dest("journal-note"));
        for (String bad : new String[] { null, "", "Meal", "meal.ogg", "../x", "a/b", "meal photo", "1meal", "abcdefghijklmnopqrstuvwxyzabcdefg" }) {
            assertNull(String.valueOf(bad), MemoFiles.dest(bad));
        }
    }

    @Test public void aLabelFromAnIntentIsShortPlainTextOrNothing() {
        assertEquals("Meal photo", MemoFiles.label(" Meal photo "));
        for (String bad : new String[] { null, "", "   ", "abcdefghijklmnopqrstuvwxyz", "Meal\nphoto", "Meal\u0007" + "x" }) {
            assertNull(String.valueOf(bad), MemoFiles.label(bad));
        }
    }

    /** A cut-off recording for a destination is recovered under the same name, so it still goes where it was meant to. */
    @Test public void aCutOffRecordingKeepsItsDestination() throws Exception {
        File inbox = tmp.newFolder();
        File cutOff = new File(tmp.newFolder(), "cutoff");
        File part = new File(inbox, "1700000000000-ab12cd34.meal.ogg.part");
        Files.write(part.toPath(), new byte[5000]);
        MemoRecovery.Found found = MemoRecovery.recover(inbox, cutOff, null);
        assertEquals(1, found.recovered);
        assertTrue(new File(inbox, "1700000000000-ab12cd34.meal.ogg").isFile());
    }
}
