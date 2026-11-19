package net.kckern.daylight.cap.lockdown;

import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

/** Ordered safety intent. Parsing failure is never interpreted as release. */
public final class LockdownCommand {
    public final boolean locked;
    public final Long until;
    public final Long revision;
    private LockdownCommand(boolean locked, Long until, Long revision) {
        this.locked=locked; this.until=until; this.revision=revision;
    }
    private static long integer(Object value) {
        if (!(value instanceof Number)) throw new IllegalArgumentException("Integer required");
        Number number=(Number)value;
        long integer=number.longValue();
        if (!Double.isFinite(number.doubleValue()) || number.doubleValue()!=(double)integer
                || integer<1 || integer>9007199254740991L) throw new IllegalArgumentException("Unsafe integer");
        return integer;
    }
    public static LockdownCommand parse(String body, long now) {
        if (body==null) throw new IllegalArgumentException("Body required");
        try {
            JSONTokener tokens=new JSONTokener(body);
            Object parsed=tokens.nextValue();
            if (!(parsed instanceof JSONObject) || tokens.nextClean()!=0) throw new IllegalArgumentException("JSON object required");
            JSONObject object=(JSONObject)parsed;
            Object locked=object.opt("locked");
            if (!(locked instanceof Boolean)) throw new IllegalArgumentException("Boolean locked required");
            Long until=object.has("lockedUntil") && !object.isNull("lockedUntil") ? integer(object.get("lockedUntil")) : null;
            Long revision=object.has("revision") ? integer(object.get("revision")) : null;
            if ((Boolean)locked && until!=null && until<=now) throw new IllegalArgumentException("Future deadline required");
            if (!(Boolean)locked && until!=null) throw new IllegalArgumentException("Release must not contain deadline");
            return new LockdownCommand((Boolean)locked,until,revision);
        } catch (JSONException error) { throw new IllegalArgumentException("Invalid lockdown JSON",error); }
    }
    public long deadline() { return !locked?0:(until==null?Long.MAX_VALUE:until); }
    public boolean canApply(long currentRevision,long currentDeadline) {
        if (revision==null) return currentRevision==0;
        return revision>currentRevision || (revision==currentRevision && deadline()==currentDeadline);
    }
}
