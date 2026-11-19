package net.kckern.daylight.shell;

import static org.junit.Assert.*;

import org.json.JSONObject;
import org.junit.Test;

import java.util.ArrayList;
import java.util.List;

public class OwnerReleaseTest {
    private static final class FakeDevice implements OwnerRelease.Device {
        boolean owner = true, holdStored = true;
        String failAt;
        final List<String> calls = new ArrayList<>();
        private void call(String name) throws Exception {
            calls.add(name);
            if (name.equals(failAt)) throw new SecurityException("refused");
        }
        @Override public boolean isOwner() { return owner; }
        @Override public boolean setHold(String why) { calls.add("hold"); return holdStored; }
        @Override public void clearPreferredHome() throws Exception { call("home"); }
        @Override public void clearLockTaskPackages() throws Exception { call("lockTaskPackages"); }
        @Override public void enableStatusBar() throws Exception { call("statusBar"); }
        @Override public void enableKeyguard() throws Exception { call("keyguard"); }
        @Override public void stopLockTask() throws Exception { call("stopLockTask"); }
    }

    @Test public void theShellClearsTheHomePreferenceAndLockTaskByItself() throws Exception {
        FakeDevice d = new FakeDevice();
        ShellServer.Reply r = OwnerRelease.run(d);
        assertEquals(200, r.status);
        JSONObject o = new JSONObject(r.body);
        assertTrue(o.getBoolean("released"));
        // The hold first: a payload that is still running re-applies within seconds otherwise.
        assertEquals(java.util.Arrays.asList("hold", "home", "lockTaskPackages", "statusBar", "keyguard", "stopLockTask"), d.calls);
        assertEquals(5, o.getJSONArray("done").length());
        assertEquals(0, o.getJSONArray("failed").length());
    }

    @Test public void anAppThatIsNotOwnerIsToldSoAndNothingIsCalled() throws Exception {
        FakeDevice d = new FakeDevice();
        d.owner = false;
        ShellServer.Reply r = OwnerRelease.run(d);
        assertEquals(409, r.status);
        assertEquals("not_device_owner", new JSONObject(r.body).getString("error"));
        assertTrue(d.calls.isEmpty());
    }

    @Test public void aStepThatFailsIsReportedAndTheRestStillRun() throws Exception {
        FakeDevice d = new FakeDevice();
        d.failAt = "lockTaskPackages";
        ShellServer.Reply r = OwnerRelease.run(d);
        assertEquals(500, r.status);
        JSONObject o = new JSONObject(r.body);
        assertFalse(o.getBoolean("ok"));
        assertEquals("release_incomplete", o.getString("error"));
        assertEquals(1, o.getJSONArray("failed").length());
        assertTrue(d.calls.contains("stopLockTask"));
        assertTrue(d.calls.contains("statusBar"));
    }

    @Test public void aHoldThatCannotBeStoredIsAFailureThatDoesNotStopTheRelease() throws Exception {
        FakeDevice d = new FakeDevice();
        d.holdStored = false;
        ShellServer.Reply r = OwnerRelease.run(d);
        assertEquals(500, r.status);
        assertFalse(new JSONObject(r.body).getBoolean("ownerHold"));
        assertTrue(d.calls.contains("home"));
    }
}
