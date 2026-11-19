package net.kckern.daylight.api;

import static org.junit.Assert.*;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.nio.file.Files;

public class PayloadStateTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    @Test public void aResetDeletesTheOverridesTheirBackupAndTheTemporaryFile() throws Exception {
        File dir = tmp.newFolder();
        File overrides = PayloadState.settingsOverrides(dir);
        assertTrue(overrides.getParentFile().mkdirs());
        File bak = new File(overrides.getPath() + ".bak"), part = new File(overrides.getPath() + ".part");
        for (File f : new File[] { overrides, bak, part }) Files.write(f.toPath(), "{}".getBytes("UTF-8"));

        assertTrue(PayloadState.deleteSettingsOverrides(dir));

        assertFalse(overrides.exists());
        // The payload reads the backup when the file is missing: a reset that left it
        // would bring the bad setting straight back.
        assertFalse(bak.exists());
        assertFalse(part.exists());
    }

    @Test public void aResetWithNothingStoredIsASuccess() throws Exception {
        assertTrue(PayloadState.deleteSettingsOverrides(tmp.newFolder()));
    }
}
