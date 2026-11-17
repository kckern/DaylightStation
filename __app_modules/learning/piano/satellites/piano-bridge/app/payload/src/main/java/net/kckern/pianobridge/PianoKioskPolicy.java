package net.kckern.pianobridge;
import java.util.function.BooleanSupplier;
import java.util.function.LongSupplier;

/** Policy seam; platform setters must never substitute for verified readback. */
public final class PianoKioskPolicy {
    public interface Port { Readback read(); void apply(); void release(); }
    public interface Store { long read(); void write(long value) throws Exception; }
    public static final class Readback {
        public final Boolean owner, homeCorrect, lockTaskLocked, statusBarDisabled,
                lockTaskPackagesCorrect, lockTaskFeaturesNone, persistentHomeCorrect;
        public Readback(Boolean owner, Boolean home, Boolean locked, Boolean status,
                        Boolean packages, Boolean features, Boolean persistentHome) {
            this.owner=owner; homeCorrect=home; lockTaskLocked=locked; statusBarDisabled=status;
            lockTaskPackagesCorrect=packages; lockTaskFeaturesNone=features; persistentHomeCorrect=persistentHome;
        }
    }
    public static final class Snapshot {
        public final Readback readback;
        public final Boolean owner, homeCorrect, lockTaskLocked, statusBarDisabled;
        public final boolean enforced;
        public final String reason;
        Snapshot(Readback r, boolean e, String reason) {
            readback=r; enforced=e; this.reason=reason;
            owner=r.owner; homeCorrect=r.homeCorrect; lockTaskLocked=r.lockTaskLocked; statusBarDisabled=r.statusBarDisabled;
        }
    }
    public static final class Maintenance {
        public final boolean allowed;
        Maintenance(boolean allowed) {this.allowed=allowed;}
    }
    public static final long MAX_MAINTENANCE_MS = 900000L;
    private final Port port;
    private final Store store;
    private final BooleanSupplier running;
    private final LongSupplier wall, elapsed;
    private long deadline, monotonicDeadline;
    PianoKioskPolicy(Port p, Store s, BooleanSupplier running, LongSupplier wall, LongSupplier elapsed) {
        port=p; store=s; this.running=running; this.wall=wall; this.elapsed=elapsed;
        deadline=s.read();
        monotonicDeadline=elapsed.getAsLong()+Math.min(MAX_MAINTENANCE_MS, Math.max(0, deadline-wall.getAsLong()));
    }
    public synchronized Snapshot probe() {
        Readback r;
        try { r=port.read(); } catch (RuntimeException e) { r=new Readback(null,null,null,null,null,null,null); }
        String reason;
        if (!Boolean.TRUE.equals(r.owner)) reason="containment-unavailable";
        else if (!running.getAsBoolean()) reason="safety-authority-unavailable-or-stopped";
        else if (maintenance().allowed) reason="maintenance";
        else if (r.homeCorrect==null || r.lockTaskLocked==null || r.statusBarDisabled==null
                || r.lockTaskPackagesCorrect==null || r.lockTaskFeaturesNone==null || r.persistentHomeCorrect==null)
            reason="readback-unavailable";
        else if (r.homeCorrect && r.lockTaskLocked && r.statusBarDisabled && r.lockTaskPackagesCorrect
                && r.lockTaskFeaturesNone && r.persistentHomeCorrect) reason="enforced";
        else reason="policy-drift";
        return new Snapshot(r, "enforced".equals(reason), reason);
    }
    public synchronized Snapshot enforce() {
        Snapshot before=probe();
        if (Boolean.TRUE.equals(before.readback.owner) && running.getAsBoolean() && !maintenance().allowed) {
            try { port.apply(); } catch (RuntimeException e) {
                return new Snapshot(probe().readback, false, "policy-write-failed");
            }
        }
        return probe();
    }
    public synchronized void setMaintenanceUntil(long deadlineEpochMs) throws Exception {
        if (deadlineEpochMs > 0 && !running.getAsBoolean()) throw new IllegalStateException("safety authority unavailable or stopped");
        long now=wall.getAsLong();
        long until=deadlineEpochMs <= now ? 0 : Math.min(deadlineEpochMs, now+MAX_MAINTENANCE_MS);
        store.write(until); // Publish only after durable commit. Failed writes grant nothing.
        deadline=until;
        monotonicDeadline=elapsed.getAsLong()+Math.max(0, until-now);
        if (until>0) {
            try { if (Boolean.TRUE.equals(port.read().owner)) port.release(); }
            catch (RuntimeException e) { store.write(0); deadline=0; throw e; }
        } else enforce();
    }
    public synchronized Maintenance maintenance() {
        return new Maintenance(running.getAsBoolean() && deadline>wall.getAsLong()
                && elapsed.getAsLong()<monotonicDeadline);
    }
}
