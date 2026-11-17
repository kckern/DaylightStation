package net.kckern.daylight.cap.quickinput.shell;

import static org.junit.Assert.*;

import org.junit.After;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.nio.file.Files;

public class MemoRecoveryTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    @After public void tearDown() { MemoRecovery.carLive(null); }

    private static File write(File dir, String name, int bytes) throws Exception {
        File f = new File(dir, name);
        Files.write(f.toPath(), new byte[bytes]);
        return f;
    }

    @Test public void aCutOffOggBecomesAMemoAndAnMp4IsKeptAside() throws Exception {
        File inbox = tmp.newFolder("inbox"), cutOff = new File(tmp.getRoot(), "cutoff");
        write(inbox, "1700000000000-0000abcd.journal.ogg.part", 8192);
        write(inbox, "1700000000001-0000abcd-00.meal.m4a.part", 8192);
        MemoRecovery.Found found = MemoRecovery.recover(inbox, cutOff, null);
        assertEquals(1, found.recovered);
        assertEquals(1, found.unplayable);
        assertTrue(new File(inbox, "1700000000000-0000abcd.journal.ogg").isFile());
    }

    /** The car screen records into the same inbox: the phone recorder's recovery leaves its file alone. */
    @Test public void theCarsRecordingUnderWayIsLeftAloneByEveryRecovery() throws Exception {
        File inbox = tmp.newFolder("inbox"), cutOff = new File(tmp.getRoot(), "cutoff");
        File car = write(inbox, "1700000000002-00001234.journal.ogg.part", 8192);
        MemoRecovery.carLive("1700000000002-00001234");
        assertEquals(0, MemoRecovery.recover(inbox, cutOff, null).recovered);
        assertEquals(0, MemoRecovery.recover(inbox, cutOff, "1700000000009-00000000").recovered);
        assertTrue(car.isFile());
        MemoRecovery.carLive(null);
        assertEquals("once the car is done with it, a cut-off one is recovered", 1, MemoRecovery.recover(inbox, cutOff, null).recovered);
    }
}
