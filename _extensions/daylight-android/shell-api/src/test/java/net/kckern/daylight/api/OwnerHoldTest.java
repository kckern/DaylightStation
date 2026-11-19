package net.kckern.daylight.api;

import static org.junit.Assert.*;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;

public class OwnerHoldTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    @Test public void aHoldIsSetReadAndCleared() throws Exception {
        File dir = tmp.newFolder();
        assertFalse(OwnerHold.isSet(dir));
        assertNull(OwnerHold.reason(dir));
        assertTrue(OwnerHold.set(dir, "released by the lifeline"));
        assertTrue(OwnerHold.isSet(dir));
        assertEquals("released by the lifeline", OwnerHold.reason(dir));
        assertTrue(OwnerHold.clear(dir));
        assertFalse(OwnerHold.isSet(dir));
        assertTrue("clearing nothing is a success", OwnerHold.clear(dir));
    }

    @Test public void theHoldSurvivesASettingsReset() throws Exception {
        // The lifeline's reset is for a bad stored setting. It must not hand owner policy back.
        File dir = tmp.newFolder();
        OwnerHold.set(dir, "ownership transferred to this app");
        PayloadState.deleteSettingsOverrides(dir);
        assertTrue(OwnerHold.isSet(dir));
    }

    @Test public void itLivesInThePayloadsStateDirectory() throws Exception {
        File files = tmp.newFolder();
        assertEquals(new File(files, "payloads"), OwnerHold.payloadDir(files));
        assertEquals(new File(new File(new File(files, "payloads"), "state"), "owner-hold"), OwnerHold.marker(OwnerHold.payloadDir(files)));
        assertFalse(OwnerHold.isSet(null));
    }
}
