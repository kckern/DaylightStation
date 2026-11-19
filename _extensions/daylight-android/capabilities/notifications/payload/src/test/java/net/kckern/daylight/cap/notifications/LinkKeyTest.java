package net.kckern.daylight.cap.notifications;

import static org.junit.Assert.*;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

public class LinkKeyTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    @Test public void createsAKeyOnceAndKeepsIt() throws Exception {
        File f = new File(tmp.newFolder(), "state/link-key");
        String first = LinkKey.loadOrCreate(f);
        assertEquals(32, first.length());
        assertTrue(first.matches("[0-9a-f]{32}"));
        assertEquals(first, LinkKey.loadOrCreate(f));
    }

    @Test public void replacesAKeyThatIsTooShortToTrust() throws Exception {
        File f = new File(tmp.newFolder(), "link-key");
        Files.write(f.toPath(), "abc".getBytes(StandardCharsets.UTF_8));
        assertEquals(32, LinkKey.loadOrCreate(f).length());
    }

    @Test public void twoInstallsDoNotShareAKey() throws Exception {
        assertNotEquals(LinkKey.loadOrCreate(new File(tmp.newFolder(), "a")), LinkKey.loadOrCreate(new File(tmp.newFolder(), "b")));
    }

    @Test public void aKeyThatCannotBeStoredStillWorksForThisRun() throws Exception {
        File notADirectory = tmp.newFile("occupied");
        String key = LinkKey.loadOrCreate(new File(notADirectory, "link-key"));
        assertTrue(key.matches("[0-9a-f]{32}"));
    }

    @Test public void rotatingMakesANewKeyAndRemembersTheOneBefore() throws Exception {
        File f = new File(tmp.newFolder(), "state/link-key");
        String first = LinkKey.loadOrCreate(f);
        LinkKey.Rotation r = LinkKey.rotate(f);
        assertEquals(first, r.previous);
        assertTrue(r.current.matches("[0-9a-f]{32}"));
        assertNotEquals(first, r.current);
        assertEquals("the new key is the stored one", r.current, LinkKey.loadOrCreate(f));
        assertEquals("", LinkKey.rotate(new File(tmp.newFolder(), "fresh")).previous);
    }
}
