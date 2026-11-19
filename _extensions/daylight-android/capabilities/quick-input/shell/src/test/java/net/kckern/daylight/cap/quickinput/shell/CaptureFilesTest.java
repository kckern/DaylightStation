package net.kckern.daylight.cap.quickinput.shell;

import static org.junit.Assert.*;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

public class CaptureFilesTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    /** The payload's quick-input capability reads this directory (InputInbox.INPUTS_DIR) and these endings. */
    @Test public void theInboxAndTheNamesAreTheOnesThePayloadReads() {
        assertEquals("inputs/inbox", CaptureFiles.INBOX);
        assertEquals(".txt", CaptureFiles.TEXT);
        assertEquals(".jpg", CaptureFiles.PHOTO);
        assertEquals("1700000000000-ab12cd34.journal-note.txt", CaptureFiles.name("1700000000000-ab12cd34", "journal-note", CaptureFiles.TEXT));
        assertEquals("1700000000000-ab12cd34.meal-photo.jpg", CaptureFiles.name("1700000000000-ab12cd34", "meal-photo", CaptureFiles.PHOTO));
    }

    @Test public void whatIsWrittenAppearsWholeUnderItsFinalNameOrNotAtAll() throws Exception {
        File inbox = new File(tmp.getRoot(), "inputs/inbox");
        byte[] body = "Oatmeal, banana".getBytes(StandardCharsets.UTF_8);
        File done = CaptureFiles.write(inbox, "1700000000000-ab12cd34", "meal-note", CaptureFiles.TEXT, body);
        assertEquals("1700000000000-ab12cd34.meal-note.txt", done.getName());
        assertArrayEquals(body, Files.readAllBytes(done.toPath()));
        assertEquals("no part file is left behind", 1, inbox.listFiles().length);
    }

    @Test public void aWriteThatCannotBeMadeLeavesNothing() throws Exception {
        File notADirectory = tmp.newFile("in-the-way");
        assertNull(CaptureFiles.write(notADirectory, "1700000000000-ab12cd34", "meal-note", CaptureFiles.TEXT, new byte[4]));
        assertNull("a destination that is not an id is never part of a file name",
                CaptureFiles.write(tmp.newFolder(), "1700000000000-ab12cd34", "../escape", CaptureFiles.TEXT, new byte[4]));
        assertNull(CaptureFiles.write(tmp.newFolder(), "../1700000000000-ab12cd34", "meal-note", CaptureFiles.TEXT, new byte[4]));
        assertNull("nothing to write is nothing to queue", CaptureFiles.write(tmp.newFolder(), "1700000000000-ab12cd34", "meal-note", CaptureFiles.TEXT, new byte[0]));
    }

    /** A screen that was killed part-way leaves a .part file; it is removed once it is plainly nobody's. */
    @Test public void aPartFileIsSweptOnlyOnceItIsOld() throws Exception {
        File inbox = tmp.newFolder();
        long now = 1_700_000_000_000L;
        File fresh = new File(inbox, "1700000000000-ab12cd34.meal-photo.raw.part");
        File old = new File(inbox, "1690000000000-ab12cd34.meal-photo.raw.part");
        File oldText = new File(inbox, "1690000000000-ab12cd35.journal-note.txt.part");
        File finished = new File(inbox, "1690000000000-ab12cd36.meal-photo.jpg");
        for (File f : new File[] { fresh, old, oldText, finished }) Files.write(f.toPath(), new byte[8]);
        assertTrue(fresh.setLastModified(now - CaptureFiles.STALE_MS + 1000));
        assertTrue(old.setLastModified(now - CaptureFiles.STALE_MS - 1000));
        assertTrue(oldText.setLastModified(now - CaptureFiles.STALE_MS - 1000));
        assertTrue(finished.setLastModified(1L));
        assertEquals(2, CaptureFiles.sweep(inbox, now));
        assertTrue("a capture that may still be under way is left alone", fresh.exists());
        assertFalse(old.exists());
        assertFalse(oldText.exists());
        assertTrue("a finished input is never swept: it is the queue's", finished.exists());
        assertEquals(0, CaptureFiles.sweep(new File(inbox, "absent"), now));
    }
    // ── the photo screen's file, and what the provider serves ────────────────

    @Test public void aCaptureIsWrittenByTheCameraUnderANameOfItsOwn() {
        assertEquals("1700000000000-ab12cd34.meal-photo.raw.part", CaptureFiles.rawName("1700000000000-ab12cd34", "meal-photo"));
        assertEquals("1700000000000-ab12cd34.meal-photo.jpg.part", CaptureFiles.encodedName("1700000000000-ab12cd34", "meal-photo"));
        assertEquals("1700000000000-ab12cd34", CaptureFiles.idOf("1700000000000-ab12cd34.meal-photo.raw.part"));
        assertEquals("meal-photo", CaptureFiles.destOf("1700000000000-ab12cd34.meal-photo.raw.part"));
        assertNull(CaptureFiles.idOf("1700000000000-ab12cd34.meal-photo.jpg"));
        assertNull(CaptureFiles.destOf("anything else"));
    }

    /** The provider gives a camera app one thing: the file of a capture under way, by its exact name. */
    @Test public void theProviderServesTheFileOfACaptureAndNothingElse() {
        String name = "1700000000000-ab12cd34.meal-photo.raw.part";
        assertEquals(name, CaptureFiles.served(java.util.Arrays.asList("capture", name)));
        String[][] refused = {
                { name },                                                   // no directory
                { "capture" },
                { "capture", name, "extra" },
                { "other", name },
                { "capture", "1700000000000-ab12cd34.meal-photo.jpg" },      // a finished photo
                { "capture", "1700000000000-ab12cd34.journal-note.txt" },    // typed text
                { "capture", "1700000000000-ab12cd34.journal-note.txt.part" },
                { "capture", "1700000000000-ab12cd34.meal-photo.jpg.part" }, // the encoded photo
                { "capture", "1700000000000-ab12cd34.ogg" },
                { "capture", ".." },
                { "capture", "../../payloads/state/link-key" },
                { "capture", "..%2f..%2fshell.log" },
                { "capture", "1700000000000-ab12cd34.Meal.raw.part" },
                { "capture", "abc.meal-photo.raw.part" },
                { "capture", "1700000000000-ab12cd34.meal-photo.raw.part/x" },
                { "capture", "" },
        };
        for (String[] path : refused) assertNull(java.util.Arrays.toString(path), CaptureFiles.served(java.util.Arrays.asList(path)));
        assertNull(CaptureFiles.served(null));
        assertNull(CaptureFiles.served(java.util.Collections.<String>emptyList()));
    }

    @Test public void theProvidersPathIsTheOneTheManifestGrants() {
        assertEquals("/capture/1700000000000-ab12cd34.meal-photo.raw.part", CaptureFiles.uriPath("1700000000000-ab12cd34.meal-photo.raw.part"));
        assertEquals(".inputs", CaptureFiles.AUTHORITY_SUFFIX);
    }

    /** A camera writes its picture. Reading alone, or a mode nobody knows, is not what the file is for. */
    @Test public void aCaptureFileIsOpenedForWriting() {
        for (String mode : new String[] { "w", "wt", "wa", "rw", "rwt" }) assertTrue(mode, CaptureFiles.modeAllowed(mode));
        for (String mode : new String[] { "r", "", null, "x", "rx", "wrt?" }) assertFalse(String.valueOf(mode), CaptureFiles.modeAllowed(mode));
    }
}
