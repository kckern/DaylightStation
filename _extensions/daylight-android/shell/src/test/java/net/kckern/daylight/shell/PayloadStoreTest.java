package net.kckern.daylight.shell;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.io.File;
import java.nio.file.Files;

import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/**
 * A bug in the shell's payload state cannot be fixed by pushing a payload, so every
 * rule in PayloadStore has a test.
 */
public class PayloadStoreTest {

    @Rule public TemporaryFolder tmp = new TemporaryFolder();
    private PayloadStore store;

    private File jar(String name) throws Exception {
        File f = new File(store.dir(), name);
        Files.write(f.toPath(), ("payload:" + name).getBytes());
        return f;
    }

    @Before public void setUp() throws Exception {
        store = new PayloadStore(tmp.newFolder("payloads"));
    }

    @Test public void freshStoreHasNoPointers() {
        assertNull(store.current());
        assertNull(store.previous());
        assertTrue(store.available().isEmpty());
    }

    @Test public void activateSetsCurrentAndDemotesOldToPrevious() throws Exception {
        jar("p1.jar"); jar("p2.jar");
        store.activate("p1.jar");
        assertEquals("p1.jar", store.current());
        assertNull(store.previous());
        store.activate("p2.jar");
        assertEquals("p2.jar", store.current());
        assertEquals("p1.jar", store.previous());
    }

    @Test public void activateRefusesAMissingJar() throws Exception {
        try { store.activate("ghost.jar"); fail("expected IOException"); }
        catch (java.io.IOException expected) { }
        assertNull(store.current());
    }

    @Test public void reactivatingCurrentDoesNotClobberPrevious() throws Exception {
        jar("p1.jar"); jar("p2.jar");
        store.activate("p1.jar"); store.activate("p2.jar");
        store.activate("p2.jar"); // idempotent re-activate
        assertEquals("p1.jar", store.previous()); // NOT "p2.jar"
    }

    @Test public void rollbackSwapsCurrentAndPrevious() throws Exception {
        jar("p1.jar"); jar("p2.jar");
        store.activate("p1.jar"); store.activate("p2.jar");
        assertEquals("p1.jar", store.rollback());
        assertEquals("p1.jar", store.current());
        assertEquals("p2.jar", store.previous()); // the broken one is one step away, deliberately
    }

    @Test public void rollbackWithNothingToFallBackToReturnsNull() throws Exception {
        jar("p1.jar");
        store.activate("p1.jar");
        assertNull(store.rollback());
        assertEquals("p1.jar", store.current()); // untouched
    }

    @Test public void crashCounterTripsAtLimitInsideWindow() throws Exception {
        jar("p1.jar"); jar("p2.jar");
        store.activate("p1.jar"); store.activate("p2.jar");
        long t = 1_000_000L;
        store.recordBoot("p2.jar", t);
        store.recordBoot("p2.jar", t + 60_000);
        assertFalse("two boots is fine", store.shouldRollBack(t + 60_000));
        store.recordBoot("p2.jar", t + 120_000);
        assertTrue("third boot in 10 min = crash loop", store.shouldRollBack(t + 120_000));
    }

    @Test public void crashCounterIgnoresBootsOutsideTheWindow() throws Exception {
        jar("p1.jar"); jar("p2.jar");
        store.activate("p1.jar"); store.activate("p2.jar");
        long t = 1_000_000L;
        store.recordBoot("p2.jar", t);
        store.recordBoot("p2.jar", t + 1_000);
        // A third boot well after the window: the two old ones have aged out.
        long later = t + PayloadStore.CRASH_WINDOW_MS + 5_000;
        store.recordBoot("p2.jar", later);
        assertEquals(1, store.recentBoots("p2.jar", later));
        assertFalse(store.shouldRollBack(later));
    }

    @Test public void noRollbackWhenThereIsNoPreviousEvenIfCrashing() throws Exception {
        // A crash-looping FIRST payload has nothing to fall back to; the shell's baked
        // asset handles that case, not this store. Must not report true and loop.
        jar("p1.jar");
        store.activate("p1.jar");
        for (int i = 0; i < 5; i++) store.recordBoot("p1.jar", 1_000_000L + i);
        assertFalse(store.shouldRollBack(1_000_010L));
    }

    @Test public void cleanStopResetsTheCrashCounter() throws Exception {
        jar("p1.jar"); jar("p2.jar");
        store.activate("p1.jar"); store.activate("p2.jar");
        for (int i = 0; i < 3; i++) store.recordBoot("p2.jar", 1_000_000L + i);
        assertTrue(store.shouldRollBack(1_000_003L));
        store.markCleanStop("p2.jar");
        assertFalse("an orderly stop is not a crash", store.shouldRollBack(1_000_003L));
    }

    @Test public void commitAcceptsMatchingShaAndRefusesMismatch() throws Exception {
        File part = new File(store.dir(), "dl.part");
        Files.write(part.toPath(), "hello".getBytes());
        String good = PayloadStore.sha256(part);
        store.commit(part, "p9.jar", good);
        assertTrue(new File(store.dir(), "p9.jar").isFile());
        assertFalse(part.exists());

        File bad = new File(store.dir(), "dl2.part");
        Files.write(bad.toPath(), "hello".getBytes());
        try { store.commit(bad, "p10.jar", "deadbeef"); fail("expected sha mismatch"); }
        catch (java.io.IOException expected) { }
        assertFalse("a rejected drop leaves no file behind", new File(store.dir(), "p10.jar").exists());
        assertFalse(bad.exists());
    }

    @Test public void commitRefusesAMissingSha() throws Exception {
        File part = new File(store.dir(), "dl.part");
        Files.write(part.toPath(), "x".getBytes());
        try { store.commit(part, "p.jar", null); fail("unverified drops must be refused"); }
        catch (java.io.IOException expected) { }
    }

    @Test public void availableListsOnlyJarsSorted() throws Exception {
        jar("b.jar"); jar("a.jar");
        Files.write(new File(store.dir(), "current").toPath(), "a.jar".getBytes());
        assertEquals(java.util.Arrays.asList("a.jar", "b.jar"), store.available());
    }

    @Test public void availableLeavesOutCrashCountersAndPointers() throws Exception {
        jar("p0-baked-v1.jar"); jar("p-0123456789ab.jar");
        store.activate("p0-baked-v1.jar");
        store.activate("p-0123456789ab.jar");
        store.recordBoot("p0-baked-v1.jar", 1_000_000L);
        store.recordBoot("p-0123456789ab.jar", 1_000_000L);
        store.recordShellStamp("1");
        assertTrue(new File(store.dir(), "boots.p0-baked-v1.jar").isFile());
        assertEquals(java.util.Arrays.asList("p-0123456789ab.jar", "p0-baked-v1.jar"), store.available());
    }

    @Test public void theShellStampIsRememberedAcrossInstances() throws Exception {
        assertNull(store.shellStamp());
        store.recordShellStamp("7");
        assertEquals("7", new PayloadStore(store.dir()).shellStamp());
    }

    @Test public void aPushedPayloadIsNamedAfterItsHash() {
        assertEquals("p-0123456789ab.jar",
                PayloadStore.pushedName("0123456789ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef"));
    }

    @Test public void commitNeverWritesABakedOrBookkeepingName() throws Exception {
        for (String name : new String[] { "p0-baked.jar", "p0-baked-v2.jar", "boots.p1.jar", "current" }) {
            File part = new File(store.dir(), "dl.part");
            Files.write(part.toPath(), "hello".getBytes());
            try { store.commit(part, name, PayloadStore.sha256(part)); fail("expected a refusal for " + name); }
            catch (java.io.IOException expected) { }
            assertFalse(name, new File(store.dir(), name).exists());
        }
    }
}
