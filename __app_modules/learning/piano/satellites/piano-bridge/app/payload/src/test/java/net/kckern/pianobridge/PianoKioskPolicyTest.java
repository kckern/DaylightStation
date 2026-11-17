package net.kckern.pianobridge;

import org.junit.Test;
import static org.junit.Assert.*;

public class PianoKioskPolicyTest {
    static class Port implements PianoKioskPolicy.Port {
        PianoKioskPolicy.Readback state = new PianoKioskPolicy.Readback(true, true, true, true, true, true, true);
        int applies, releases;
        Runnable afterRead = () -> {};
        public PianoKioskPolicy.Readback read() { afterRead.run(); return state; }
        public void apply() { applies++; }
        public void release() { releases++; }
    }
    static class Store implements PianoKioskPolicy.Store {
        long deadline;
        Runnable afterWrite = () -> {};
        public long read() { return deadline; }
        public void write(long value) { deadline = value; afterWrite.run(); }
    }
    final Port port = new Port();
    final Store store = new Store();
    long wall = 1000, elapsed = 0;
    boolean running = true;
    PianoKioskPolicy policy() {
        return new PianoKioskPolicy(port, store, () -> running, () -> wall, () -> elapsed);
    }
    @Test public void absentOwnerCannotClaimContainment() {
        port.state = new PianoKioskPolicy.Readback(false, true, true, true, true, true, true);
        PianoKioskPolicy.Snapshot snapshotWithoutOwner = policy().probe();
        assertFalse(snapshotWithoutOwner.enforced);
        assertEquals("containment-unavailable", snapshotWithoutOwner.reason);
    }
    @Test public void homeAndLockTaskMustBothBeVerified() {
        port.state = new PianoKioskPolicy.Readback(true, true, false, true, true, true, true);
        PianoKioskPolicy.Snapshot homeOnly = policy().probe();
        port.state = new PianoKioskPolicy.Readback(true, false, false, true, true, true, true);
        PianoKioskPolicy.Snapshot screenPinnedOnly = policy().probe();
        port.state = new PianoKioskPolicy.Readback(true, true, true, true, true, true, true);
        PianoKioskPolicy.Snapshot realLockTaskAndHome = policy().probe();
        assertFalse(homeOnly.enforced);
        assertFalse(screenPinnedOnly.enforced);
        assertTrue(realLockTaskAndHome.enforced);
    }
    @Test public void maintenanceExpiresAndStopOverridesIt() throws Exception {
        PianoKioskPolicy p = policy();
        p.setMaintenanceUntil(wall + 900000);
        assertTrue(p.maintenance().allowed);
        assertEquals(1, port.releases);
        p.enforce();
        assertEquals(0, port.applies);
        elapsed = 900001;
        PianoKioskPolicy.Maintenance maintenanceAt900001 = p.maintenance();
        assertFalse(maintenanceAt900001.allowed);
        p.enforce();
        assertEquals(1, port.applies);
        elapsed = 0;
        p.setMaintenanceUntil(wall + 900000);
        running = false;
        PianoKioskPolicy.Maintenance stoppedMaintenance = p.maintenance();
        assertFalse(stoppedMaintenance.allowed);
    }
    @Test public void acceptedWritesAreNotReadback() throws Exception {
        port.state = new PianoKioskPolicy.Readback(true, true, true, null, true, true, null);
        PianoKioskPolicy p = policy();
        assertFalse(p.enforce().enforced);
        assertEquals("readback-unavailable", p.probe().reason);
        assertEquals(1, port.applies);
    }
    @Test public void unknownAuthorityCannotLaunchOrGrantMaintenance() throws Exception {
        running = false;
        PianoKioskPolicy p = policy();
        p.enforce();
        assertEquals(0, port.applies);
        try { p.setMaintenanceUntil(wall + 1000); fail("unknown authority accepted"); }
        catch (IllegalStateException expected) { }
    }
    @Test public void maintenanceIsBoundedPersistedAndExplicitlyRevoked() throws Exception {
        PianoKioskPolicy p = policy();
        p.setMaintenanceUntil(wall + 1800000);
        assertEquals(wall + 900000, store.deadline);
        assertTrue(policy().maintenance().allowed);
        p.setMaintenanceUntil(0);
        assertFalse(p.maintenance().allowed);
        assertEquals(0, store.deadline);
    }
    @Test public void revokedOwnerIsVisibleAndDoesNotApply() throws Exception {
        PianoKioskPolicy p = policy();
        assertTrue(p.probe().enforced);
        port.state = new PianoKioskPolicy.Readback(false, true, true, true, true, true, true);
        assertEquals("containment-unavailable", p.enforce().reason);
        assertEquals(0, port.applies);
    }
    @Test public void revokedAuthorityDuringPersistenceWithholdsRelease() throws Exception {
        PianoKioskPolicy p = policy();
        store.afterWrite = () -> running = false;
        try { p.setMaintenanceUntil(2000); fail("release reported success after revocation"); }
        catch (IllegalStateException expected) { }
        assertEquals(0, port.releases);
        assertEquals(2000, store.deadline);
        assertFalse(p.maintenance().allowed);
    }
    @Test public void revokedAuthorityDuringReadbackWithholdsRelease() throws Exception {
        PianoKioskPolicy p = policy();
        port.afterRead = () -> running = false;
        try { p.setMaintenanceUntil(2000); fail("release reported success after revocation"); }
        catch (IllegalStateException expected) { }
        assertEquals(0, port.releases);
        assertEquals(2000, store.deadline);
        assertFalse(p.maintenance().allowed);
    }
}
