package net.kckern.daylight.shell;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.After;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

public class ShellLogTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    @After public void tearDown() { ShellLog.installIn(null); }

    @Test public void theLogLivesUnderTheAppPrivateFilesDirectory() throws Exception {
        File filesDir = tmp.newFolder("files");
        ShellLog.installIn(filesDir);
        assertEquals(new File(filesDir, "diag/shell.log"), ShellLog.file());
        ShellLog.note("TEST", "hello");
        String text = new String(Files.readAllBytes(ShellLog.file().toPath()), StandardCharsets.UTF_8);
        assertTrue(text, text.trim().endsWith("TEST: hello"));
    }

    @Test public void withNoFilesDirectoryThereIsNoLogFileInsteadOfARelativePath() {
        ShellLog.installIn(null);
        assertNull(ShellLog.file());
        ShellLog.note("TEST", "goes to logcat only");
    }
}
