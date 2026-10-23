package net.kckern.pianobridge;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import org.junit.Test;
import java.util.ArrayList;
import java.util.List;

public class AdapterCyclerTest {

    /** Fake adapter: state flips after `lag` polls; records calls. */
    static class FakeOps implements AdapterCycler.Ops {
        boolean enabled = true;
        int enableRefusals = 0;     // enable() returns false (and does nothing) this many times
        boolean stuckOff = false;   // enable() never takes effect
        int enableThrows = 0;       // enable() throws this many times
        final List<String> calls = new ArrayList<>();
        public boolean isEnabled() { return enabled; }
        public boolean disable() { calls.add("disable"); enabled = false; return true; }
        public boolean enable() {
            calls.add("enable");
            if (enableThrows > 0) { enableThrows--; throw new SecurityException("BLUETOOTH_ADMIN revoked"); }
            if (enableRefusals > 0) { enableRefusals--; return false; }
            if (!stuckOff) enabled = true;
            return true;
        }
    }

    static class FakeClock implements AdapterCycler.Clock {
        long t = 0; final List<Long> sleeps = new ArrayList<>();
        public long now() { return t; }
        public void sleep(long ms) { sleeps.add(ms); t += ms; }
    }

    @Test public void cycles_offThenSettleThenOn() {
        FakeOps ops = new FakeOps(); FakeClock clk = new FakeClock();
        AdapterCycler.Result r = new AdapterCycler(ops, clk).run(5000);
        assertTrue(r.ok);
        assertEquals("disable", ops.calls.get(0));
        assertEquals("enable", ops.calls.get(1));
        assertTrue(ops.enabled);
        assertTrue(clk.sleeps.contains(5000L));
    }

    @Test public void enableRefusedOnce_isRetriedByTheWatchdog() {
        FakeOps ops = new FakeOps(); ops.enableRefusals = 1;
        AdapterCycler.Result r = new AdapterCycler(ops, new FakeClock()).run(0);
        assertTrue(r.ok);
        assertTrue(ops.enabled);
        assertEquals(2, ops.calls.stream().filter("enable"::equals).count());
    }

    @Test public void adapterThatNeverComesBack_reportsStuckOffAfterTheWatchdogWindow() {
        FakeOps ops = new FakeOps(); ops.stuckOff = true;
        FakeClock clk = new FakeClock();
        AdapterCycler.Result r = new AdapterCycler(ops, clk).run(0);
        assertFalse(r.ok);
        assertEquals("stuck-off", r.error);
        assertTrue("watchdog keeps trying for 30s", clk.t >= 30_000);
    }

    @Test public void alreadyOff_stillTurnsItOn() {
        FakeOps ops = new FakeOps(); ops.enabled = false;
        AdapterCycler.Result r = new AdapterCycler(ops, new FakeClock()).run(0);
        assertTrue(r.ok);
        assertTrue(ops.enabled);
    }

    @Test public void secondConcurrentRun_isBusy() {
        AdapterCycler c = new AdapterCycler(new FakeOps(), new FakeClock());
        assertTrue(c.tryBegin());
        assertEquals("busy", c.run(0).error);
        c.end();
        assertTrue(c.run(0).ok);
    }

    @Test public void settleIsClamped() {
        FakeClock clk = new FakeClock();
        new AdapterCycler(new FakeOps(), clk).run(999_999);
        assertTrue(clk.sleeps.contains(30_000L));
        assertFalse(clk.sleeps.contains(999_999L));
    }

    @Test public void enableThrowing_isCaughtAndRetried_neverLeavesBluetoothOff() {
        FakeOps ops = new FakeOps(); ops.enableThrows = 2;
        AdapterCycler.Result r = new AdapterCycler(ops, new FakeClock()).run(0);
        assertTrue(r.ok);
        assertTrue(ops.enabled);
    }

    @Test public void stuckOff_keepsRetryingSlowlyForFiveMinutesBeforeGivingUp() {
        FakeOps ops = new FakeOps(); ops.stuckOff = true;
        FakeClock clk = new FakeClock();
        AdapterCycler.Result r = new AdapterCycler(ops, clk).run(0);
        assertEquals("stuck-off", r.error);
        assertTrue("slow retries continue past the 30 s watchdog", clk.t >= 5 * 60_000L);
        assertTrue(ops.calls.stream().filter("enable"::equals).count() > 20);
    }
}
