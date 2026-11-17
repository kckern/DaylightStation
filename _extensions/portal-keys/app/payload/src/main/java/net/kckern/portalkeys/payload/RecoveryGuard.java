package net.kckern.portalkeys.payload;

import org.json.JSONObject;
import java.util.function.Supplier;

/** Read-only safety at proposal and immediately before each native recovery effect. */
final class RecoveryGuard {
    private final Supplier<JSONObject> safety;
    private final boolean preservationVerified;
    private final long revision;
    RecoveryGuard(Supplier<JSONObject> safety, boolean preservationVerified) {
        this.safety=safety; this.preservationVerified=preservationVerified;
        JSONObject initial=read();
        revision=HomeWatchdog.pageSafe(initial)?initial.optLong("revision",-1):-1;
    }
    private JSONObject read() {
        try { JSONObject value=safety.get(); return value==null?new JSONObject():value; }
        catch (RuntimeException | LinkageError unavailable) { return new JSONObject(); }
    }
    boolean run(boolean mayRecreate, Runnable action) {
        JSONObject current=read();
        if (revision<=0 || !HomeWatchdog.pageSafe(current) || current.optLong("revision",-1)!=revision
                || (mayRecreate && !preservationVerified)) return false;
        action.run(); return true;
    }
}
