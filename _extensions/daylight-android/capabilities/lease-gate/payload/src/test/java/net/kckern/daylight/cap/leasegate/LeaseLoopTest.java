package net.kckern.daylight.cap.leasegate;

import static org.junit.Assert.*;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;

public class LeaseLoopTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();
    private static final String SECRET = "0123456789abcdef0123456789abcdef";

    @Test public void onlyAnHttpsEndpointALongCredentialAndAnotherPackageAreAccepted() {
        assertTrue(LeaseLoop.validConfig("https://app.example/api/v1/supervision/native-lease", SECRET, "com.example.game", "net.kckern.daylight.shield"));
        assertFalse(LeaseLoop.validConfig("http://app.example/lease", SECRET, "com.example.game", "net.kckern.daylight.shield"));
        assertFalse(LeaseLoop.validConfig("https://user@app.example/lease", SECRET, "com.example.game", "net.kckern.daylight.shield"));
        assertFalse(LeaseLoop.validConfig("https://app.example/lease?x=1", SECRET, "com.example.game", "net.kckern.daylight.shield"));
        assertFalse(LeaseLoop.validConfig("https://app.example/lease", "short", "com.example.game", "net.kckern.daylight.shield"));
        assertFalse(LeaseLoop.validConfig("https://app.example/lease", SECRET, "not a package", "net.kckern.daylight.shield"));
        assertFalse("the gate never hides its own app", LeaseLoop.validConfig("https://app.example/lease", SECRET, "net.kckern.daylight.shield", "net.kckern.daylight.shield"));
        assertFalse("nothing set is not provisioned", LeaseLoop.validConfig("", "", "", "net.kckern.daylight.shield"));
    }

    @Test public void orderingSurvivesARestartButAGrantDoesNot() throws Exception {
        File file = new File(tmp.newFolder(), "lease-order.json");
        LeaseOrder order = new LeaseOrder(file);
        LeaseDeadline first = order.load();
        assertEquals(-1, first.epoch());
        assertTrue(first.accept(100, 100, 3, 7, false, true, 3000));
        assertTrue(order.save(first));

        LeaseDeadline second = new LeaseOrder(file).load();
        assertEquals(3, second.epoch());
        assertEquals(7, second.revision());
        assertTrue("a restart starts blocked", second.blocked(100));
    }

    @Test public void aCorruptOrderFileStartsFromTheBeginningAndBlocked() throws Exception {
        File file = new File(tmp.newFolder(), "lease-order.json");
        java.nio.file.Files.write(file.toPath(), "{nope".getBytes());
        LeaseDeadline lease = new LeaseOrder(file).load();
        assertEquals(-1, lease.epoch());
        assertTrue(lease.desiredBlocked());
    }

    @Test public void theOrderFileIsWrittenIntoADirectoryThatDoesNotExistYet() throws Exception {
        File file = new File(new File(tmp.newFolder(), "state"), "lease-order.json");
        assertTrue(new LeaseOrder(file).save(new LeaseDeadline(2, 5, true)));
        assertEquals(5, new LeaseOrder(file).load().revision());
    }

    @Test public void packageHidingSaysWhyItIsNotAvailable() {
        // A device with no device-admin feature can never have a device owner, so no app can hide a package there.
        String noAdmin = LeaseLoop.hidingUnsupportedReason(false, false, false);
        assertTrue(noAdmin, noAdmin.contains("android.software.device_admin"));
        // A provider that is present but not ready: the app is not device owner.
        assertTrue(LeaseLoop.hidingUnsupportedReason(true, false, true).contains("device owner"));
        // No provider on a device that could have one: the capability that hides packages is not in this build.
        assertTrue(LeaseLoop.hidingUnsupportedReason(false, false, true).contains("no capability"));
        assertNull("a ready gate needs no excuse", LeaseLoop.hidingUnsupportedReason(true, true, true));
    }
}
