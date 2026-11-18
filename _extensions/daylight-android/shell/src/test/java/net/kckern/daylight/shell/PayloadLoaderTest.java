package net.kckern.daylight.shell;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

import net.kckern.daylight.shell.LoaderHarness.FakePayload;

import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.util.concurrent.TimeUnit;

public class PayloadLoaderTest {
    private static final String BAKED_V1 = "p0-baked-v1.jar";
    private static final String URL = "http://192.0.2.10:8899/next.jar";
    private static final long WAIT_MS = 5000L;

    @Rule public TemporaryFolder tmp = new TemporaryFolder();
    private LoaderHarness h;

    @Before public void setUp() throws Exception { h = new LoaderHarness(tmp.newFolder("payloads")); }

    private PayloadLoader booted(String stamp) throws Exception {
        PayloadLoader loader = h.loader(stamp);
        loader.boot().get(WAIT_MS, TimeUnit.MILLISECONDS);
        return loader;
    }

    /** A store as a running device has it: stamp recorded, {@code jars} activated in order. */
    private void existing(String stamp, String... jars) throws Exception {
        PayloadStore store = new PayloadStore(h.dir);
        store.recordShellStamp(stamp);
        for (String jar : jars) store.activate(jar);
    }

    // ── boot ────────────────────────────────────────────────────────────────

    @Test public void aFreshInstallBootsTheBakedPayload() throws Exception {
        PayloadLoader loader = booted("1");
        assertEquals(BAKED_V1, loader.activeJar());
        assertEquals("baked", loader.active().version());
        assertEquals(BAKED_V1, loader.store().current());
        assertNull(loader.store().previous());
        assertEquals("1", loader.store().shellStamp());
        assertEquals(1, h.last(BAKED_V1).starts.get());
        assertTrue(loader.status().isNull("lastError"));
    }

    @Test public void bootReturnsBeforeThePayloadHasStarted() throws Exception {
        h.jar("p-hang.jar", "hang");
        existing("1", "p-hang.jar");
        PayloadLoader loader = h.loader("1");
        long began = System.nanoTime();
        loader.boot();
        assertTrue("boot() must not run start() on the caller's thread",
                TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - began) < LoaderHarness.DEADLINE_MS);
        loader.awaitIdle(WAIT_MS);
        h.last("p-hang.jar").release.countDown();
    }

    @Test public void aPayloadWhoseStartThrowsIsRolledBackToThePrevious() throws Exception {
        h.jar("p-good.jar", "good:1");
        h.jar("p-bad.jar", "throw");
        existing("1", "p-good.jar", "p-bad.jar");
        PayloadLoader loader = booted("1");
        assertEquals("p-good.jar", loader.activeJar());
        assertEquals("p-good.jar", loader.store().current());
        assertEquals("p-bad.jar", loader.store().previous());
        assertEquals("p-bad.jar", loader.status().getString("lastFailed"));
        assertEquals(1, h.last("p-bad.jar").starts.get());
    }

    @Test public void aHungStartLeavesTheLifelineAnswerableAndFencesFallback() throws Exception {
        h.jar("p-good.jar", "good:1");
        h.jar("p-hang.jar", "hang");
        existing("1", "p-good.jar", "p-hang.jar");
        final PayloadLoader loader = h.loader("1");
        loader.boot();
        // Wait until start() is really stuck, then use the loader the way the lifeline does.
        long deadline = System.currentTimeMillis() + WAIT_MS;
        while (h.last("p-hang.jar") == null && System.currentTimeMillis() < deadline) Thread.sleep(5);
        FakePayload hung = h.last("p-hang.jar");
        assertNotNull(hung);
        assertTrue(hung.entered.await(WAIT_MS, TimeUnit.MILLISECONDS));

        long began = System.nanoTime();
        assertEquals("p-hang.jar", loader.status().getString("starting"));
        ShellServer lifeline = new ShellServer(new ShellServer.Host() {
            @Override public PayloadLoader loaderOrNull() { return loader; }
            @Override public int versionCode() { return 1; }
            @Override public OwnerRelease.Device ownerDevice() { return null; }
        }, 0, ShellServerTest.TOKEN);
        assertEquals(200, lifeline.handle("GET", "/payload", ShellServerTest.TOKEN, null, null).status);
        assertEquals(200, lifeline.handle("POST", "/restart", ShellServerTest.TOKEN, null, null).status);
        assertTrue("lifeline calls must not wait for the stuck start()",
                TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - began) < LoaderHarness.DEADLINE_MS);

        loader.awaitIdle(WAIT_MS);
        assertNull(loader.active());
        assertNull(h.last("p-good.jar"));
        assertTrue(loader.status().getString("recoveryReason").contains("cleanup exceeded"));
        assertTrue(loader.requestRestart().startsWith("refused:"));
        hung.release.countDown();
    }

    @Test public void aNewProcessConsumesPendingRecoveryUsingTheBakedAsset() throws Exception {
        h.jar("p-hang.jar", "hang");
        existing("1", "p-hang.jar");
        PayloadLoader stuck = booted("1");
        h.last("p-hang.jar").release.countDown();
        assertNull(booted("1").active());
        String reason = stuck.status().getString("recoveryReason");

        h = new LoaderHarness(h.dir);
        PayloadLoader recovered = booted("1");
        assertEquals(BAKED_V1, recovered.activeJar());
        assertEquals(reason, recovered.status().getString("recoveryReason"));
        assertFalse(recovered.store().recoveryPending());
        assertNull(recovered.store().previous());
        assertNull(h.last("p-hang.jar"));
        recovered.shutdown();
        h.jar(BAKED_V1, "throw");
        PayloadLoader subsequent = booted("1");
        assertNull(subsequent.active());
        assertNull(h.last("p-hang.jar"));
    }

    @Test public void interruptedRecoveryDiscardsStalePreviousAndPreservesLatestReason() throws Exception {
        h.jar("p-fenced.jar", "good:fenced");
        h.jar(BAKED_V1, "good:baked");
        existing("1", "p-fenced.jar", BAKED_V1);
        // Disk state after the pending marker was renamed, before completion.
        h.jar("last-recovery", "older diagnostic");
        h.jar("recovery-pending", "latest diagnostic");
        PayloadStore store = new PayloadStore(h.dir);
        assertEquals("latest diagnostic", store.recoveryReason());

        h.baked = "throw";
        PayloadLoader failedRecovery = booted("1");
        assertNull(failedRecovery.active());
        assertNull(store.previous());
        assertTrue(store.recoveryPending());
        assertEquals("latest diagnostic", failedRecovery.status().getString("recoveryReason"));

        h.baked = "good:baked";
        PayloadLoader recovered = booted("1");
        assertEquals(BAKED_V1, recovered.activeJar());
        assertFalse(store.recoveryPending());
        assertEquals("latest diagnostic", new PayloadStore(h.dir).recoveryReason());
        assertNull(h.last("p-fenced.jar"));
    }

    @Test public void failedStartKeepsExclusiveListenerUntilStopReturns() throws Exception {
        exerciseExclusiveStop(false);
    }

    @Test public void stalledStopFencesQueuedRestartsAndReportsOneRecovery() throws Exception {
        exerciseExclusiveStop(true);
    }

    private void exerciseExclusiveStop(boolean stall) throws Exception {
        java.util.concurrent.CountDownLatch stopping = new java.util.concurrent.CountDownLatch(1);
        java.util.concurrent.CountDownLatch release = new java.util.concurrent.CountDownLatch(1);
        java.util.concurrent.atomic.AtomicInteger owners = new java.util.concurrent.atomic.AtomicInteger();
        java.util.concurrent.atomic.AtomicInteger maxOwners = new java.util.concurrent.atomic.AtomicInteger();
        h.jar("p-good.jar", "good");
        h.jar("p-bad.jar", "throw");
        existing("1", "p-good.jar", "p-bad.jar");
        PayloadLoader loader = new PayloadLoader(h.dir, h.shell, jar -> new net.kckern.daylight.api.Payload() {
            @Override public void start(net.kckern.daylight.api.ShellServices shell) {
                maxOwners.accumulateAndGet(owners.incrementAndGet(), Math::max);
                if (jar.getName().equals("p-bad.jar")) throw new IllegalStateException("failed after bind");
            }
            @Override public void stop() {
                stopping.countDown();
                try { release.await(); } catch (InterruptedException e) { throw new AssertionError(e); }
                owners.decrementAndGet();
            }
            @Override public String version() { return "fixture"; }
            @Override public void onShellComponent(String name, Object instance) { }        }, dst -> {}, (url, dst) -> {}, "1", WAIT_MS, stall ? 250 : WAIT_MS, h.processFences);
        java.util.concurrent.Future<?> boot = loader.boot();
        try {
            assertTrue(stopping.await(WAIT_MS, TimeUnit.MILLISECONDS));
            assertNull(loader.active());
            assertEquals(1, owners.get());
            if (stall) {
                assertTrue(loader.requestRestart().startsWith("accepted:"));
                assertEquals("accepted: restart already pending", loader.requestRestart());
                boot.get(WAIT_MS, TimeUnit.MILLISECONDS);
                loader.awaitIdle(WAIT_MS);
                assertNull(loader.active());
                assertTrue(loader.status().getString("recoveryReason").contains("cleanup exceeded"));
                assertEquals(1, h.shell.notes.stream().filter(n -> n.contains("cleanup exceeded")).count());
            }
        } finally {
            release.countDown();
        }
        boot.get(WAIT_MS, TimeUnit.MILLISECONDS);
        assertEquals(1, maxOwners.get());
        if (!stall) {
            assertEquals("p-good.jar", loader.activeJar());
            loader.shutdown();
            assertEquals(0, owners.get());
        }
    }

    @Test public void whenCurrentAndPreviousBothFailTheBakedPayloadRuns() throws Exception {
        h.jar("p-a.jar", "throw");
        h.jar("p-b.jar", "throw");
        existing("1", "p-a.jar", "p-b.jar");
        PayloadLoader loader = booted("1");
        assertEquals(BAKED_V1, loader.activeJar());
        assertEquals(BAKED_V1, loader.store().current());
    }

    @Test public void aCurrentPointerToAMissingJarFallsBackToTheBakedPayload() throws Exception {
        h.jar("p-gone.jar", "good:1");
        existing("1", "p-gone.jar");
        assertTrue(new File(h.dir, "p-gone.jar").delete());
        PayloadLoader loader = booted("1");
        assertEquals(BAKED_V1, loader.activeJar());
    }

    @Test public void withNoPayloadAtAllTheLoaderReportsItAndStaysUsable() throws Exception {
        h.baked = null;
        PayloadLoader loader = booted("1");
        assertNull(loader.active());
        assertFalse(loader.status().isNull("lastError"));
        assertTrue(loader.requestRestart().startsWith("refused: "));
    }

    // ── shell reinstall ─────────────────────────────────────────────────────

    @Test public void aNewShellActivatesItsBakedPayloadAndKeepsTheOldOneAsPrevious() throws Exception {
        PayloadLoader first = booted("1");
        String sha = h.offer(URL, "good:pushed");
        first.requestSwap(URL, sha);
        first.awaitIdle(WAIT_MS);
        String pushed = PayloadStore.pushedName(sha);
        assertEquals(pushed, first.activeJar());
        first.shutdown();

        h.baked = "good:baked-2";
        PayloadLoader second = booted("2");
        assertEquals("p0-baked-v2.jar", second.activeJar());
        assertEquals("baked-2", second.active().version());
        assertEquals("p0-baked-v2.jar", second.store().current());
        assertEquals(pushed, second.store().previous());
        assertEquals("2", second.store().shellStamp());
    }

    @Test public void theSameShellKeepsAPushedPayloadAcrossARestart() throws Exception {
        PayloadLoader first = booted("1");
        String sha = h.offer(URL, "good:pushed");
        first.requestSwap(URL, sha);
        first.awaitIdle(WAIT_MS);
        first.shutdown();

        h.baked = "good:must-not-be-used";
        PayloadLoader second = booted("1");
        assertEquals(PayloadStore.pushedName(sha), second.activeJar());
        assertEquals("pushed", second.active().version());
    }

    @Test public void aStoreFromBeforeTheStampWasRecordedCountsAsANewShell() throws Exception {
        h.jar("p0-baked.jar", "good:old-baked");
        new PayloadStore(h.dir).activate("p0-baked.jar");
        PayloadLoader loader = booted("1");
        assertEquals(BAKED_V1, loader.activeJar());
        assertEquals("p0-baked.jar", loader.store().previous());
    }

    @Test public void aNewShellWhoseBakedPayloadFailsGoesBackToTheOldPayload() throws Exception {
        h.jar("p-good.jar", "good:1");
        existing("1", "p-good.jar");
        h.baked = "throw";
        PayloadLoader loader = booted("2");
        assertEquals("p-good.jar", loader.activeJar());
        assertEquals("p0-baked-v2.jar", loader.store().previous());
    }

    // ── swap ────────────────────────────────────────────────────────────────

    @Test public void aGoodSwapRunsTheNewPayloadUnderItsHashName() throws Exception {
        PayloadLoader loader = booted("1");
        FakePayload old = h.last(BAKED_V1);
        String sha = h.offer(URL, "good:pushed");
        assertTrue(loader.requestSwap(URL, sha).startsWith("accepted: "));
        loader.awaitIdle(WAIT_MS);
        String name = "p-" + sha.substring(0, 12) + ".jar";
        assertEquals(name, loader.activeJar());
        assertEquals(1, old.stops.get());
        assertEquals(BAKED_V1, loader.store().previous());
        assertFalse("the URL's basename is never a stored name", new File(h.dir, "next.jar").exists());
    }

    @Test public void aSwapWithTheWrongShaIsRefusedAndTheRunningPayloadIsUntouched() throws Exception {
        PayloadLoader loader = booted("1");
        FakePayload running = h.last(BAKED_V1);
        h.offer(URL, "good:pushed");
        String wrong = "0000000000000000000000000000000000000000000000000000000000000000";
        loader.requestSwap(URL, wrong);
        loader.awaitIdle(WAIT_MS);
        assertSame(running, loader.active());
        assertEquals(0, running.stops.get());
        assertEquals(1, running.starts.get());
        assertEquals(BAKED_V1, loader.store().current());
        assertNull(loader.store().previous());
        assertTrue(loader.status().getString("lastError").contains("sha256 mismatch"));
        assertEquals(java.util.Collections.singletonList(BAKED_V1), loader.store().available());
    }

    @Test public void aSwapWithAMalformedShaIsRefusedAtOnce() throws Exception {
        PayloadLoader loader = booted("1");
        assertTrue(loader.requestSwap(URL, "0123456789abcdef0123456789abcdef").startsWith("refused: "));
        assertTrue(loader.requestSwap(URL, null).startsWith("refused: "));
        assertTrue(loader.requestSwap("", "0000000000000000000000000000000000000000000000000000000000000000").startsWith("refused: "));
    }

    @Test public void aSwapWhoseDownloadFailsLeavesTheRunningPayloadUntouched() throws Exception {
        PayloadLoader loader = booted("1");
        FakePayload running = h.last(BAKED_V1);
        loader.requestSwap("http://192.0.2.10:8899/absent.jar", "0000000000000000000000000000000000000000000000000000000000000000");
        loader.awaitIdle(WAIT_MS);
        assertSame(running, loader.active());
        assertEquals(0, running.stops.get());
    }

    @Test public void aPushedPayloadThatCannotStartIsRolledBack() throws Exception {
        PayloadLoader loader = booted("1");
        String sha = h.offer(URL, "throw");
        loader.requestSwap(URL, sha);
        loader.awaitIdle(WAIT_MS);
        assertEquals(BAKED_V1, loader.activeJar());
        assertEquals(BAKED_V1, loader.store().current());
        assertEquals(PayloadStore.pushedName(sha), loader.status().getString("lastFailed"));
    }

    @Test public void pushingTheRunningPayloadAgainDoesNotRewriteItsJar() throws Exception {
        PayloadLoader loader = booted("1");
        String sha = h.offer(URL, "good:pushed");
        loader.requestSwap(URL, sha);
        loader.awaitIdle(WAIT_MS);
        File stored = new File(h.dir, PayloadStore.pushedName(sha));
        Object identity = java.nio.file.Files.readAttributes(stored.toPath(), java.nio.file.attribute.BasicFileAttributes.class).fileKey();
        assertTrue(stored.setLastModified(1_000_000_000_000L));

        loader.requestSwap("http://192.0.2.10:8899/same-bytes-other-name.jar", h.offer("http://192.0.2.10:8899/same-bytes-other-name.jar", "good:pushed"));
        loader.awaitIdle(WAIT_MS);
        assertEquals(1_000_000_000_000L, stored.lastModified());
        assertEquals(identity, java.nio.file.Files.readAttributes(stored.toPath(), java.nio.file.attribute.BasicFileAttributes.class).fileKey());
        assertEquals(stored.getName(), loader.activeJar());
    }

    // ── rollback / restart / shutdown ───────────────────────────────────────

    @Test public void rollbackWithNoPreviousIsRefused() throws Exception {
        PayloadLoader loader = booted("1");
        FakePayload running = h.last(BAKED_V1);
        assertEquals("refused: no previous payload", loader.requestRollback());
        loader.awaitIdle(WAIT_MS);
        assertSame(running, loader.active());
        assertEquals(0, running.stops.get());
    }

    @Test public void aManualRollbackRunsThePreviousPayload() throws Exception {
        PayloadLoader loader = booted("1");
        loader.requestSwap(URL, h.offer(URL, "good:pushed"));
        loader.awaitIdle(WAIT_MS);
        assertTrue(loader.requestRollback().startsWith("accepted: "));
        loader.awaitIdle(WAIT_MS);
        assertEquals(BAKED_V1, loader.activeJar());
    }

    @Test public void restartStopsAndStartsTheCurrentPayload() throws Exception {
        PayloadLoader loader = booted("1");
        FakePayload before = h.last(BAKED_V1);
        assertTrue(loader.requestRestart().startsWith("accepted: "));
        loader.awaitIdle(WAIT_MS);
        assertEquals(1, before.stops.get());
        assertEquals(BAKED_V1, loader.activeJar());
        assertTrue(loader.active() != before);
    }

    @Test public void nothingQueuedRunsAfterShutdown() throws Exception {
        PayloadLoader loader = booted("1");
        FakePayload running = h.last(BAKED_V1);
        loader.shutdown();
        assertEquals(1, running.stops.get());
        assertNull(loader.active());
        int openedBefore = h.opened.size();
        assertEquals("refused: loader is shut down", loader.requestSwap(URL, h.offer(URL, "good:pushed")));
        assertEquals("refused: loader is shut down", loader.requestRestart());
        assertEquals(openedBefore, h.opened.size());
        assertEquals(BAKED_V1, loader.store().current());
    }

    // ── shell components ────────────────────────────────────────────────────

    private FakePayload waitForOpened(String jar) throws Exception {
        long deadline = System.currentTimeMillis() + WAIT_MS;
        while (h.last(jar) == null && System.currentTimeMillis() < deadline) Thread.sleep(5);
        FakePayload p = h.last(jar);
        assertNotNull(jar + " was never opened", p);
        assertTrue(p.entered.await(WAIT_MS, TimeUnit.MILLISECONDS));
        return p;
    }

    @Test public void aComponentPublishedWhileAPayloadIsStartingReachesThatPayload() throws Exception {
        // Launch-on-boot: the kiosk Activity is created while start() is still running.
        h.jar("p-slow.jar", "slow");
        existing("1", "p-slow.jar");
        PayloadLoader loader = h.loader("1", WAIT_MS);
        java.util.concurrent.Future<?> boot = loader.boot();
        FakePayload starting = waitForOpened("p-slow.jar");
        assertNull("still starting", loader.active());

        loader.onShellComponent("kiosk-activity", "activity-1");

        assertEquals(java.util.Arrays.asList("kiosk-activity=activity-1"), starting.components);
        starting.release.countDown();
        boot.get(WAIT_MS, TimeUnit.MILLISECONDS);
        assertSame(starting, loader.active());
        loader.onShellComponent("accessibility", "service-1");
        assertEquals("once active it is told exactly once per change",
                java.util.Arrays.asList("kiosk-activity=activity-1", "accessibility=service-1"), starting.components);
    }

    @Test public void aPayloadThatWasGivenUpOnIsNotToldAboutComponents() throws Exception {
        h.jar("p-good.jar", "good:1");
        h.jar("p-hang.jar", "hang");
        existing("1", "p-good.jar", "p-hang.jar");
        PayloadLoader loader = booted("1");
        assertNull(loader.active());
        loader.onShellComponent("kiosk-activity", "activity-1");
        assertTrue(h.last("p-hang.jar").components.isEmpty());
        assertNull(h.last("p-good.jar"));
        h.last("p-hang.jar").release.countDown();
    }

    @Test public void aShutdownDuringStartDoesNotMoveThePointers() throws Exception {
        h.jar("p-good.jar", "good:1");
        h.jar("p-hang.jar", "hang");
        existing("1", "p-good.jar", "p-hang.jar");
        PayloadLoader loader = h.loader("1");
        loader.boot();
        long deadline = System.currentTimeMillis() + WAIT_MS;
        while (h.last("p-hang.jar") == null && System.currentTimeMillis() < deadline) Thread.sleep(5);
        loader.shutdown();
        assertEquals("p-hang.jar", loader.store().current());
        assertEquals("p-good.jar", loader.store().previous());
        assertNull(loader.active());
        h.last("p-hang.jar").release.countDown();
    }
}
