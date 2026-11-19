package net.kckern.portalkeys.payload;

import org.junit.Test;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import static org.junit.Assert.*;

public class OwnerTransferTest {
    /** Records every call in order; nothing here touches Android. */
    private static final class FakeDevice implements OwnerTransfer.Device {
        final List<String> calls = new ArrayList<>();
        int sdk = 28;
        boolean owner = true;
        String failingStep;
        RuntimeException transferFailure;
        @Override public int sdk() { return sdk; }
        @Override public boolean isOwner() { return owner; }
        @Override public void holdEnforcement() { calls.add("hold"); }
        @Override public void release(String step) {
            calls.add("release:" + step);
            if (step.equals(failingStep)) throw new SecurityException("denied " + step);
        }
        @Override public void transfer(String target) {
            calls.add("transfer:" + target);
            if (transferFailure != null) throw transferFailure;
        }
    }

    private static List<String> expectedReleaseCalls() {
        List<String> out = new ArrayList<>();
        out.add("hold");
        for (String step : OwnerTransfer.RELEASE_STEPS) out.add("release:" + step);
        return out;
    }

    @Test public void wrongTargetIsRefusedAndNothingIsCalled() {
        for (String to : new String[]{null, "", "com.example/.Admin",
                "net.kckern.daylight.portal/.DaylightAdminReceiver",
                OwnerTransfer.TARGET + " ", OwnerTransfer.TARGET.toUpperCase(),
                "net.kckern.daylight.portal/net.kckern.daylight.cap.lockdown.shell.DaylightAdminReceiver2"}) {
            FakeDevice device = new FakeDevice();
            OwnerTransfer.Result r = OwnerTransfer.run(device, to);
            assertFalse(String.valueOf(to), r.ok);
            assertEquals(400, r.http);
            assertEquals("target-not-allowed", r.error);
            assertFalse(r.policyReleased);
            assertFalse(r.transferred);
            assertTrue(String.valueOf(to), device.calls.isEmpty());
        }
    }

    @Test public void rightTargetReleasesEverythingInOrderThenTransfers() {
        FakeDevice device = new FakeDevice();
        OwnerTransfer.Result r = OwnerTransfer.run(device, OwnerTransfer.TARGET);
        List<String> expected = expectedReleaseCalls();
        expected.add("transfer:" + OwnerTransfer.TARGET);
        assertEquals(expected, device.calls);
        assertTrue(r.ok);
        assertEquals(200, r.http);
        assertTrue(r.policyReleased);
        assertTrue(r.transferred);
        assertEquals(Arrays.asList(OwnerTransfer.RELEASE_STEPS), r.released);
        assertTrue(r.releaseFailures.isEmpty());
        assertNull(r.error);
    }

    @Test public void releaseOrderStartsWithHomeAndLockTask() {
        assertEquals("persistent-home", OwnerTransfer.RELEASE_STEPS[0]);
        assertEquals("lock-task-packages", OwnerTransfer.RELEASE_STEPS[1]);
        assertEquals(new java.util.HashSet<>(Arrays.asList(OwnerTransfer.RELEASE_STEPS)).size(),
                OwnerTransfer.RELEASE_STEPS.length);
    }

    @Test public void transferExceptionIsReportedWithPolicyAlreadyReleased() {
        FakeDevice device = new FakeDevice();
        device.transferFailure = new IllegalArgumentException("Provided target does not support ownership transfer.");
        OwnerTransfer.Result r = OwnerTransfer.run(device, OwnerTransfer.TARGET);
        assertFalse(r.ok);
        assertEquals(500, r.http);
        assertEquals("transfer-failed", r.error);
        assertEquals("java.lang.IllegalArgumentException", r.exception);
        assertEquals("Provided target does not support ownership transfer.", r.message);
        assertTrue(r.policyReleased);
        assertFalse(r.transferred);
        assertTrue(r.note.contains("already released"));
        // Released exactly once, transfer attempted once, and no call after the failure.
        List<String> expected = expectedReleaseCalls();
        expected.add("transfer:" + OwnerTransfer.TARGET);
        assertEquals(expected, device.calls);
    }

    @Test public void notDeviceOwnerIsRefusedBeforeAnyRelease() {
        FakeDevice device = new FakeDevice();
        device.owner = false;
        OwnerTransfer.Result r = OwnerTransfer.run(device, OwnerTransfer.TARGET);
        assertFalse(r.ok);
        assertEquals(409, r.http);
        assertEquals("not-device-owner", r.error);
        assertFalse(r.policyReleased);
        assertTrue(device.calls.isEmpty());
    }

    @Test public void belowApi28IsRefusedBeforeAnyRelease() {
        FakeDevice device = new FakeDevice();
        device.sdk = 27;
        OwnerTransfer.Result r = OwnerTransfer.run(device, OwnerTransfer.TARGET);
        assertFalse(r.ok);
        assertEquals(409, r.http);
        assertEquals("api-28-required", r.error);
        assertTrue(device.calls.isEmpty());
    }

    @Test public void aFailedReleaseStepStopsBeforeTransferButStillTriesTheRest() {
        FakeDevice device = new FakeDevice();
        device.failingStep = "status-bar";
        OwnerTransfer.Result r = OwnerTransfer.run(device, OwnerTransfer.TARGET);
        assertEquals(expectedReleaseCalls(), device.calls); // every step tried, no transfer
        assertFalse(r.ok);
        assertEquals(500, r.http);
        assertEquals("release-incomplete", r.error);
        assertFalse(r.transferred);
        assertEquals(1, r.releaseFailures.size());
        assertTrue(r.releaseFailures.get(0).startsWith("status-bar: java.lang.SecurityException"));
        assertEquals(OwnerTransfer.RELEASE_STEPS.length - 1, r.released.size());
        assertFalse(r.released.contains("status-bar"));
    }
}
