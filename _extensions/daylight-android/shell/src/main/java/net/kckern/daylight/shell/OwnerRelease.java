package net.kckern.daylight.shell;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The lifeline's POST /owner/release: the least the shell must be able to do by itself
 * to give a device back when the payload is broken and this app is device owner.
 *
 * The payload's own release (POST /lockdown/owner/release) undoes every policy. This
 * one undoes what locks a person out of the device: the persistent preferred HOME, the
 * lock-task packages, the disabled status bar and keyguard, and lock task itself. It
 * also sets the owner hold, so a payload that comes back does not apply the policy
 * again. User restrictions and hidden packages are the payload's to undo.
 *
 * Android is behind an interface so the order and the reporting are tested on the JVM.
 */
final class OwnerRelease {
    interface Device {
        boolean isOwner();
        /** Stored first: without it a running payload re-applies the policy within seconds. */
        boolean setHold(String why);
        void clearPreferredHome() throws Exception;
        void clearLockTaskPackages() throws Exception;
        void enableStatusBar() throws Exception;
        void enableKeyguard() throws Exception;
        /** Ask the kiosk Activity, when there is one, to leave lock task. */
        void stopLockTask() throws Exception;
    }

    private interface Step { void run() throws Exception; }

    private OwnerRelease() { }

    /** The lifeline's answer: status 200 when released, 409 when this app is not the owner, 500 when a step failed. */
    static ShellServer.Reply run(Device device) {
        try {
            if (!device.isOwner()) {
                return reply(409, new JSONObject().put("ok", false).put("error", "not_device_owner")
                        .put("message", "this app is not device owner; there is no owner policy to release"));
            }
            JSONArray done = new JSONArray(), failed = new JSONArray();
            boolean held = device.setHold("released by the lifeline");
            if (!held) failed.put("owner hold could not be stored: a running payload may apply the policy again");
            step(done, failed, "home preference cleared", device::clearPreferredHome);
            step(done, failed, "lock-task packages cleared", device::clearLockTaskPackages);
            step(done, failed, "status bar enabled", device::enableStatusBar);
            step(done, failed, "keyguard enabled", device::enableKeyguard);
            step(done, failed, "lock task stopped", device::stopLockTask);
            ShellLog.note("OWNER", "lifeline release: done=" + done + " failed=" + failed);
            JSONObject o = new JSONObject().put("ok", failed.length() == 0).put("released", failed.length() == 0)
                    .put("ownerHold", held).put("done", done).put("failed", failed)
                    .put("note", "user restrictions and hidden packages are undone by the payload: POST /lockdown/owner/release");
            if (failed.length() > 0) o.put("error", "release_incomplete");
            return reply(failed.length() == 0 ? 200 : 500, o);
        } catch (Exception e) {
            return new ShellServer.Reply(500, "application/json", "{\"ok\":false,\"error\":\"internal\"}");
        }
    }

    private static void step(JSONArray done, JSONArray failed, String what, Step step) {
        try {
            step.run();
            done.put(what);
        } catch (Throwable t) {
            failed.put(what + " FAILED: " + t.getClass().getSimpleName());
        }
    }

    private static ShellServer.Reply reply(int status, JSONObject o) {
        return new ShellServer.Reply(status, "application/json", o.toString());
    }
}
