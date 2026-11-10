package net.kckern.pianobridge;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import org.junit.Test;

public class HeadsetGuardTest {

    /** Fake HFP surface for the piano's speaker. */
    static class FakeOps implements HeadsetGuard.Ops {
        boolean ready = true;
        boolean connected = true;
        boolean priorityOff = false;
        boolean priorityUnknown = false;
        int binderCalls = 0;
        boolean priorityCallWorks = true;
        boolean disconnectWorks = true;
        int setPriorityCalls = 0, disconnectCalls = 0;
        public boolean ready() { return ready; }
        public boolean headsetConnected() { binderCalls++; return connected; }
        public Boolean headsetPriorityOff() { binderCalls++; return priorityUnknown ? null : priorityOff; }
        public boolean setHeadsetPriorityOff() {
            setPriorityCalls++;
            if (priorityCallWorks) priorityOff = true;
            return priorityCallWorks;
        }
        public boolean disconnectHeadset() {
            disconnectCalls++;
            if (disconnectWorks) connected = false;
            return disconnectWorks;
        }
    }

    @Test public void connectedOnHfp_turnsPriorityOffAndDisconnects() {
        FakeOps ops = new FakeOps();
        HeadsetGuard.Outcome o = new HeadsetGuard(ops).reconcile();
        assertEquals(1, ops.setPriorityCalls);
        assertEquals(1, ops.disconnectCalls);
        assertFalse(ops.connected);
        assertTrue(o.acted);
        assertTrue(o.priorityOff);
        assertTrue(o.disconnected);
    }

    @Test public void priorityBlocked_stillDisconnectsEveryTimeItReappears() {
        FakeOps ops = new FakeOps(); ops.priorityCallWorks = false;
        HeadsetGuard g = new HeadsetGuard(ops);
        g.reconcile();
        ops.connected = true;          // Android brings HFP back on the next connect
        HeadsetGuard.Outcome o = g.reconcile();
        assertEquals(2, ops.disconnectCalls);
        assertFalse(o.priorityOff);
        assertTrue(o.disconnected);
    }

    @Test public void alreadyA2dpOnly_isANoOp() {
        FakeOps ops = new FakeOps(); ops.connected = false; ops.priorityOff = true;
        HeadsetGuard.Outcome o = new HeadsetGuard(ops).reconcile();
        assertFalse(o.acted);
        assertEquals(0, ops.setPriorityCalls);
        assertEquals(0, ops.disconnectCalls);
    }

    @Test public void disconnectedButPriorityStillOn_setsPriorityWithoutDisconnecting() {
        FakeOps ops = new FakeOps(); ops.connected = false;
        HeadsetGuard.Outcome o = new HeadsetGuard(ops).reconcile();
        assertEquals(1, ops.setPriorityCalls);
        assertEquals(0, ops.disconnectCalls);
        assertTrue(o.acted);
    }

    @Test public void proxyNotReady_doesNothing() {
        FakeOps ops = new FakeOps(); ops.ready = false;
        assertFalse(new HeadsetGuard(ops).reconcile().acted);
        assertEquals(0, ops.disconnectCalls);
    }

    @Test public void countsWhatItDid() {
        FakeOps ops = new FakeOps(); ops.priorityCallWorks = false;
        HeadsetGuard g = new HeadsetGuard(ops);
        g.reconcile(); ops.connected = true; g.reconcile();
        assertEquals(2, g.disconnects());
    }

    static final class Clock { long t = 1_000_000L; }

    @Test public void refusedPriority_stopsAskingAfterThreeTries() {
        FakeOps ops = new FakeOps(); ops.priorityCallWorks = false; ops.connected = false;
        HeadsetGuard g = new HeadsetGuard(ops, () -> 0L);
        for (int i = 0; i < 10; i++) g.reconcile();
        assertEquals(3, ops.setPriorityCalls);
    }

    @Test public void changedOnlyWhenSomethingActuallyChanged() {
        FakeOps ops = new FakeOps(); ops.priorityCallWorks = false; ops.connected = false;
        HeadsetGuard g = new HeadsetGuard(ops, () -> 0L);
        assertFalse("a refused write changes nothing", g.reconcile().changed);
        ops.connected = true;
        assertTrue("a performed disconnect is a change", g.reconcile().changed);
        ops.priorityCallWorks = true; // third and last allowed attempt succeeds
        HeadsetGuard.Outcome o = g.reconcile();
        assertTrue(o.changed); // priority newly off
        assertFalse(g.reconcile().changed);
    }

    @Test public void disconnectsAreCappedPerHour_andTheCapIsReportedOnce() {
        FakeOps ops = new FakeOps(); ops.priorityCallWorks = false;
        Clock c = new Clock();
        HeadsetGuard g = new HeadsetGuard(ops, () -> c.t);
        int capNotices = 0;
        for (int i = 0; i < 15; i++) {
            ops.connected = true;
            HeadsetGuard.Outcome o = g.reconcile();
            if (o.capJustHit) capNotices++;
            c.t += 60_000L; // HFP comes back every minute
        }
        assertEquals(10, ops.disconnectCalls);
        assertEquals(1, capNotices);
        c.t += 60 * 60_000L;
        ops.connected = true;
        assertTrue(g.reconcile().disconnected);
    }

    @Test public void snapshot_reportsTheLastObservation_withoutNewBinderCalls() {
        FakeOps ops = new FakeOps();
        HeadsetGuard g = new HeadsetGuard(ops, () -> 0L);
        g.reconcile();
        int calls = ops.binderCalls;
        HeadsetGuard.Snapshot s = g.snapshot();
        assertEquals(calls, ops.binderCalls);
        assertEquals(Boolean.FALSE, s.connected);
        assertEquals(Boolean.TRUE, s.priorityOff);
    }

    @Test public void unknownPriority_isReportedAsUnknownNotAsOn() {
        FakeOps ops = new FakeOps(); ops.priorityUnknown = true; ops.connected = false; ops.priorityCallWorks = false;
        HeadsetGuard g = new HeadsetGuard(ops, () -> 0L);
        g.reconcile();
        assertEquals(null, g.snapshot().priorityOff);
    }

    @Test public void beforeAnyReconcile_snapshotIsUnknown() {
        HeadsetGuard.Snapshot s = new HeadsetGuard(new FakeOps(), () -> 0L).snapshot();
        assertEquals(null, s.connected);
        assertEquals(null, s.priorityOff);
    }
}
