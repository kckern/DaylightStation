package net.kckern.daylight.cap.lockdown;

import static org.junit.Assert.*;

import net.kckern.daylight.core.UnsupportedException;

import org.junit.Test;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;

public class OwnerPolicyTest {
    private static final String OWN = "net.kckern.daylight.portal";
    private static final List<String> HIDE = Arrays.asList("com.android.chrome", "com.android.systemui");
    private static final Set<String> LOCK_TASK = new TreeSet<>(Arrays.asList(OWN, "com.example.game"));

    @Test public void applyThenReleaseLeavesTheDeviceAsItWas() {
        FakeDevicePolicy device = new FakeDevicePolicy();
        String before = device.state();
        OwnerPolicy policy = new OwnerPolicy(device, OWN);

        assertNull(policy.apply(LOCK_TASK, HomeAlias.NAME, true, HIDE));
        assertNotEquals("apply changed the device", before, device.state());
        assertEquals(Collections.singleton(OWN + "/" + HomeAlias.NAME), device.preferredHome);
        assertTrue(device.statusBarDisabled);
        assertTrue(device.keyguardDisabled);
        assertEquals(4, device.restrictions.size());
        assertEquals(new TreeSet<>(HIDE), device.hidden);

        assertNull(policy.release(HIDE));
        assertEquals("release undid every policy apply set", before, device.state());
        assertTrue("the persistent preferred HOME is cleared", device.calls.contains("clearPersistentPreferredActivities " + OWN));
    }

    @Test public void applyingTwiceIsStillFullyReleased() {
        // The watcher re-applies every five seconds.
        FakeDevicePolicy device = new FakeDevicePolicy();
        String before = device.state();
        OwnerPolicy policy = new OwnerPolicy(device, OWN);
        policy.apply(LOCK_TASK, HomeAlias.NAME, true, HIDE);
        policy.apply(Collections.singleton(OWN), HomeAlias.NAME, true, HIDE);
        assertNull(policy.release(HIDE));
        assertEquals(before, device.state());
    }

    @Test public void relaxIsForAnUnlockWindowAndKeepsTheRest() {
        FakeDevicePolicy device = new FakeDevicePolicy();
        OwnerPolicy policy = new OwnerPolicy(device, OWN);
        policy.apply(LOCK_TASK, HomeAlias.NAME, true, HIDE);
        assertNull(policy.relax());
        assertTrue(device.lockTaskPackages.isEmpty());
        assertFalse(device.statusBarDisabled);
        assertEquals("the home preference stays through an unlock", 1, device.preferredHome.size());
        assertEquals(4, device.restrictions.size());
        assertEquals(2, device.hidden.size());
    }

    @Test public void withTheHomeAliasDisabledNoHomePreferenceIsSet() {
        FakeDevicePolicy device = new FakeDevicePolicy();
        new OwnerPolicy(device, OWN).apply(LOCK_TASK, null, false, Collections.emptyList());
        assertTrue(device.preferredHome.isEmpty());
        assertTrue(device.restrictions.isEmpty());
    }

    @Test public void aReleaseStepThatFailsDoesNotStopTheOthers() {
        FakeDevicePolicy device = new FakeDevicePolicy() {
            @Override public void setKeyguardDisabled(boolean disabled) {
                if (!disabled) throw new SecurityException("refused");
                super.setKeyguardDisabled(disabled);
            }
        };
        OwnerPolicy policy = new OwnerPolicy(device, OWN);
        policy.apply(LOCK_TASK, HomeAlias.NAME, true, HIDE);
        String failed = policy.release(HIDE);
        assertEquals("could not enable the keyguard (SecurityException)", failed);
        assertTrue("the steps after it still ran", device.restrictions.isEmpty());
        assertTrue(device.hidden.isEmpty());
        assertTrue(device.preferredHome.isEmpty());
    }

    @Test public void anAppThatIsNotOwnerAppliesAndReleasesNothing() {
        FakeDevicePolicy device = new FakeDevicePolicy();
        device.owner = false;
        OwnerPolicy policy = new OwnerPolicy(device, OWN);
        assertEquals("not device owner", policy.apply(LOCK_TASK, HomeAlias.NAME, true, HIDE));
        assertEquals("not device owner", policy.release(HIDE));
        assertNull(policy.relax());
        assertTrue(device.calls.isEmpty());
    }

    @Test public void transferNeedsOwnershipAndApi28() {
        FakeDevicePolicy device = new FakeDevicePolicy();
        OwnerPolicy policy = new OwnerPolicy(device, OWN);
        policy.transferOwnership("net.kckern.portalkeys", "net.kckern.portalkeys.PortalAdminReceiver");
        assertEquals("net.kckern.portalkeys/net.kckern.portalkeys.PortalAdminReceiver", device.transferredTo);
        assertFalse(device.owner);
        try { policy.transferOwnership("a.b", "a.b.C"); fail(); } catch (UnsupportedException expected) { }

        FakeDevicePolicy old = new FakeDevicePolicy();
        old.sdk = 27;
        try { new OwnerPolicy(old, OWN).transferOwnership("a.b", "a.b.C"); fail(); }
        catch (UnsupportedException e) { assertTrue(e.getMessage().contains("API 28")); }
        assertNull(old.transferredTo);
    }
}
