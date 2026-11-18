package net.kckern.daylight.cap.leasegate;

import static org.junit.Assert.*;

import net.kckern.daylight.core.spi.PackageGate;

import org.json.JSONObject;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

/** The loop itself, over a platform whose clock moves when the test says so. */
public class LeaseLoopBehaviorTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    private static final String ENDPOINT = "https://lease.example/v1/lease";
    private static final String CREDENTIAL = "0123456789abcdef0123456789abcdef";
    private static final String TARGET = "com.example.game";

    /** Posted work runs in due order as time advances; lease requests run when the test lets them. */
    private static final class FakePlatform implements LeaseLoop.Platform {
        private static final class Due {
            final long at; final Runnable r;
            Due(long at, Runnable r) { this.at = at; this.r = r; }
        }
        long now = 10_000;
        private final List<Due> posted = new ArrayList<>();
        final List<Runnable> requests = new ArrayList<>();
        boolean networkDown, awake;
        int awakeHolds, awakeReleases, fetches;
        /** What the next lease request answers; null is a failed request. */
        JSONObject answer;
        /** Run once, at the next reading of the clock. */
        Runnable atNextNow;

        @Override public long nowMs() {
            Runnable hook = atNextNow;
            if (hook != null) { atNextNow = null; hook.run(); }
            return now;
        }
        @Override public void post(Runnable r) { posted.add(new Due(now, r)); }
        @Override public void postDelayed(Runnable r, long delayMs) { posted.add(new Due(now + delayMs, r)); }
        @Override public void cancelPosted() { posted.clear(); }
        @Override public void network(Runnable r) {
            if (networkDown) throw new java.util.concurrent.RejectedExecutionException();
            requests.add(r);
        }
        @Override public void shutdownNetwork() { networkDown = true; }
        @Override public void holdAwake(long timeoutMs) { awake = true; awakeHolds++; }
        @Override public void releaseAwake() { awake = false; awakeReleases++; }
        @Override public boolean awakeHeld() { return awake; }
        @Override public JSONObject fetch(String endpoint, String credential, String target, boolean ready, boolean blocked, long epoch, long revision) {
            fetches++;
            return answer;
        }

        /** Move the clock forward, running what falls due on the way, in order. */
        void advance(long ms) {
            long end = now + ms;
            while (true) {
                Due next = null;
                for (Due d : posted) if (d.at <= end && (next == null || d.at < next.at)) next = d;
                if (next == null) break;
                posted.remove(next);
                now = Math.max(now, next.at);
                next.r.run();
            }
            now = end;
        }

        /** Let the request that is in flight complete, and its answer be handled. */
        void completeRequest() {
            assertFalse("no request is in flight", requests.isEmpty());
            requests.remove(0).run();
            advance(0);
        }
    }

    private static final class FakeGate implements PackageGate {
        boolean ready = true, hidden;
        /** Non-null for a gate that keeps a package from the front and cannot hide it. */
        String cannotHide;
        @Override public String hidingUnsupportedReason() { return cannotHide; }
        int changes;
        @Override public boolean ready() { return ready; }
        @Override public boolean isHidden(String packageName) { return hidden; }
        @Override public boolean setHidden(String packageName, boolean h) { hidden = h; changes++; return true; }
    }

    private FakePlatform platform;
    private FakeGate gate;
    private File orderFile;

    @Before public void setUp() throws Exception {
        platform = new FakePlatform();
        gate = new FakeGate();
        orderFile = new File(tmp.newFolder(), "state/lease-order.json");
    }

    private LeaseLoop loop() {
        return new LeaseLoop(platform, new LeaseOrder(orderFile), () -> gate, ENDPOINT, CREDENTIAL, TARGET,
                "net.kckern.daylight.example", true);
    }

    private static JSONObject grant(long epoch, long revision, long leaseMs) throws Exception {
        return new JSONObject().put("protocol", 1).put("epoch", epoch).put("commandRevision", revision)
                .put("blockedCommand", false).put("allowed", true).put("leaseMs", leaseMs);
    }

    @Test public void theLoopStartsBlockedBeforeAnyLeaseIsAsked() throws Exception {
        gate.hidden = false;                      // left open by whatever ran before
        LeaseLoop l = loop();
        l.start();
        assertTrue("blocked at once, before the first tick or request", gate.hidden);
        assertEquals(0, platform.fetches);
        assertTrue(l.status().getBoolean("blocked"));
        assertTrue(l.status().getBoolean("ready"));
    }

    @Test public void aLeaseOpensTheGateAndItsExpiryClosesItWithNoFurtherRequest() throws Exception {
        LeaseLoop l = loop();
        l.start();
        platform.advance(0);                      // first tick and first poll
        platform.answer = grant(1, 1, 3000);
        platform.completeRequest();
        assertFalse("the lease opened the gate", gate.hidden);
        assertTrue("and holds the device awake while it runs", platform.awake);

        platform.networkDown = true;              // from here on no request can even be made
        platform.advance(2900);
        assertFalse("still inside the lease", gate.hidden);
        platform.advance(200);
        assertTrue("the lease ran out and the gate closed locally", gate.hidden);
        assertFalse("a closed gate needs no wake lock", platform.awake);
        assertTrue(l.status().getBoolean("leaseBlocked"));
    }

    @Test public void aRequestThatStallsDoesNotExtendTheLease() throws Exception {
        LeaseLoop l = loop();
        l.start();
        platform.advance(0);
        platform.answer = grant(1, 1, 3000);
        platform.completeRequest();
        assertFalse(gate.hidden);

        platform.advance(1000);                   // the next poll sends a renewal, which stalls
        assertEquals(1, platform.requests.size());
        platform.advance(2500);                   // the first lease ends while it is still in flight
        assertTrue("an unanswered renewal is not a lease", gate.hidden);

        // It answers at last, with a lease counted from when it was SENT, which is over too.
        platform.answer = grant(1, 2, 2000);
        platform.completeRequest();
        assertTrue("an answer that arrives after its own lease ended opens nothing", gate.hidden);
    }

    @Test public void aFailedRequestLeavesTheGateToTheClock() throws Exception {
        LeaseLoop l = loop();
        l.start();
        platform.advance(0);
        platform.answer = null;
        platform.completeRequest();
        assertTrue(gate.hidden);
        assertFalse(platform.awake);
    }

    @Test public void aRestartStartsBlockedEvenThoughTheLastLeaseHadTimeLeft() throws Exception {
        LeaseLoop first = loop();
        first.start();
        platform.advance(0);
        platform.answer = grant(4, 9, 5000);
        platform.completeRequest();
        assertFalse(gate.hidden);
        // The process dies here: no stop(). A new loop reads the same order file.
        platform = new FakePlatform();
        LeaseLoop second = loop();
        second.start();
        assertTrue("the order of commands is kept, a lease is not", gate.hidden);
        assertEquals(4, second.status().getLong("epoch"));
        assertEquals(9, second.status().getLong("revision"));
        assertTrue(second.status().getBoolean("leaseBlocked"));
    }

    // ── stop ────────────────────────────────────────────────────────────────

    @Test public void stopClosesTheGateReleasesTheWakeLockAndNothingRunsAfterwards() throws Exception {
        LeaseLoop l = loop();
        l.start();
        platform.advance(0);
        platform.answer = grant(1, 1, 5000);
        platform.completeRequest();
        platform.advance(1000);                   // a renewal is in flight when the payload stops
        assertEquals(1, platform.requests.size());

        l.stop();
        assertTrue(gate.hidden);
        assertFalse(platform.awake);
        int changes = gate.changes;

        platform.answer = grant(1, 2, 5000);      // the in-flight request now answers with a fresh lease
        platform.requests.remove(0).run();
        platform.advance(5000);
        assertTrue("a stopped loop does not reopen the gate", gate.hidden);
        assertEquals("and does not touch it again", changes, gate.changes);
        assertFalse(platform.awake);
        l.stop();                                 // twice is safe
    }

    /**
     * The answer is already past its "has the loop stopped?" check when stop() runs
     * on another thread. Without a second check it would go on to open the gate.
     */
    @Test public void anAnswerOvertakenByStopOpensNothing() throws Exception {
        final LeaseLoop l = loop();
        l.start();
        platform.advance(0);
        platform.answer = grant(1, 1, 5000);
        platform.requests.remove(0).run();        // the answer is fetched and queued for the tick thread
        platform.atNextNow = l::stop;             // stop() lands in the middle of handling it
        platform.advance(0);
        assertTrue(gate.hidden);
        assertFalse("no wake lock is taken for a loop that has stopped", platform.awake);
        assertEquals(0, platform.awakeHolds);
    }

    @Test public void theWakeLockIsReleasedEvenWhenThereIsNoGateToClose() throws Exception {
        gate.ready = false;                       // this app is not device owner: enforce returns early
        LeaseLoop l = loop();
        l.start();
        platform.awake = true;                    // held from a lease taken while the gate was still usable
        platform.advance(100);                    // one tick
        assertFalse("the early return used to skip the release", platform.awake);

        platform.awake = true;
        l.stop();
        assertFalse(platform.awake);
    }

    // ── the capability: a real start over a fake Android context ────────────

    @Test public void theCapabilityStartsTheLoopBlockedAndStopReleasesWhatItHeld() throws Exception {
        File dir = tmp.newFolder();
        net.kckern.daylight.core.testing.FakeContext ctx = new net.kckern.daylight.core.testing.FakeContext(dir);
        net.kckern.daylight.core.CoreRuntime core = net.kckern.daylight.core.testing.TestCore.createWithContext(dir, ctx);
        try {
            core.services().provide(PackageGate.class, gate);
            LeaseGateCapability cap = new LeaseGateCapability();
            core.add(cap);
            core.prepare(new JSONObject());
            core.settings().set("lease.endpoint", ENDPOINT);
            core.settings().set("lease.credential", CREDENTIAL);
            core.settings().set("lease.packageName", TARGET);
            cap.usePlatformForTest(platform);
            gate.hidden = false;

            cap.start();
            assertTrue("the package is hidden as soon as the loop exists", gate.hidden);
            JSONObject status = net.kckern.daylight.core.testing.TestCore.get(core, "/lease");
            assertTrue(status.getBoolean("configured"));
            assertEquals("package-gate", status.getString("enforcement"));
            platform.advance(0);
            assertEquals("its first lease request is on its way", 1, platform.requests.size());
            platform.answer = grant(1, 1, 5000);
            platform.completeRequest();
            assertFalse(gate.hidden);
            assertTrue("a running lease holds the wake lock", platform.awake);

            cap.stop();
            assertTrue("stop hid the package again", gate.hidden);
            assertFalse("released the wake lock", platform.awake);
            assertTrue("shut its network thread down", platform.networkDown);
            platform.advance(10_000);
            assertEquals("and left no tick or poll behind", 0, platform.fetches - 1);
            assertEquals("unavailable", net.kckern.daylight.core.testing.TestCore.get(core, "/lease").getString("enforcement"));
            cap.stop();
            assertTrue(gate.hidden);
        } finally {
            net.kckern.daylight.core.testing.TestCore.releaseMainThread();
        }
    }

    // ── a gate that blocks and recalls (a device that cannot have a device owner) ──

    @Test public void aGateThatCannotHideStillEnforcesTheLeaseAndSaysHow() throws Exception {
        gate.cannotHide = "no device owner is possible here: a closed package is kept from the front";
        LeaseLoop l = loop();
        l.start();
        assertTrue("closed at once", gate.hidden);
        JSONObject status = l.status();
        assertEquals("block-and-recall", status.getString("enforcement"));
        assertEquals("unsupported", status.getString("packageHiding"));
        assertEquals(gate.cannotHide, status.getString("packageHidingReason"));
        platform.advance(0);
        platform.answer = grant(1, 1, 5000);
        platform.completeRequest();
        assertFalse("the lease opens this gate like any other", gate.hidden);
        assertTrue(l.status().getBoolean("ready"));
        l.stop();
        assertTrue(gate.hidden);
    }
}
