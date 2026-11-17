package net.kckern.daylight.cap.caractions.shell;

import static org.junit.Assert.*;

import net.kckern.daylight.shellkit.PackageFacts;

import org.junit.Test;

import java.util.HashMap;
import java.util.Map;

public class CarGateTest {
    private static final String AUTO = CarHostPolicy.ANDROID_AUTO;
    private static final String AUTO_CERT = "aa".repeat(32);
    private static final String OTHER_CERT = "bb".repeat(32);
    private static final int AUTO_UID = 10150;
    private static final int ATTACKER_UID = 10300;
    /** IBinder.INTERFACE_TRANSACTION, DUMP_TRANSACTION and FIRST_CALL_TRANSACTION, as android.os.IBinder defines them. */
    private static final int INTERFACE = ('_' << 24) | ('N' << 16) | ('T' << 8) | 'F';
    private static final int DUMP = ('_' << 24) | ('D' << 16) | ('M' << 8) | 'P';
    private static final int FIRST_CALL = 1;

    private static final class Facts implements PackageFacts {
        final Map<Integer, String[]> byUid = new HashMap<>();
        final Map<String, String> certs = new HashMap<>();
        @Override public String[] packagesForUid(int uid) { return byUid.get(uid); }
        @Override public String signingSha256(String packageName) { return certs.get(packageName); }
        @Override public boolean platformSigned(String packageName) { return false; }
    }

    private final Facts facts = new Facts();
    private final Map<String, String> pins = new HashMap<>();
    private long now = 1_000_000;
    private final CarGate gate = new CarGate(facts, () -> pins, () -> now);

    private void androidAuto() {
        facts.byUid.put(AUTO_UID, new String[] { AUTO });
        facts.certs.put(AUTO, AUTO_CERT);
        pins.put(AUTO, AUTO_CERT);
    }

    private void attacker() {
        facts.byUid.put(ATTACKER_UID, new String[] { "com.example.attacker" });
        facts.certs.put("com.example.attacker", OTHER_CERT);
    }

    @Test public void thePinnedHostUidIsLetThroughOnEveryKindOfCall() {
        androidAuto();
        for (int code : new int[] { FIRST_CALL, 9, 11, INTERFACE, DUMP }) {
            assertEquals(code + "", CarGate.Route.FORWARD, gate.route(AUTO_UID, code));
        }
    }

    /** The attack: bind the service, skip the handshake, ask for the manager. Every call is refused at the gate. */
    @Test public void anotherAppIsRefusedEveryCallIncludingTheDescriptorAndDump() {
        androidAuto();
        attacker();
        for (int code : new int[] { FIRST_CALL, 9 /* getManager */, 11 /* onHandshakeCompleted */, INTERFACE, DUMP }) {
            assertEquals(code + "", CarGate.Route.REFUSE, gate.route(ATTACKER_UID, code));
        }
        assertEquals(CarGate.Route.REFUSE, gate.route(-1, FIRST_CALL));
        assertEquals("a system uid is not a car host", CarGate.Route.REFUSE, gate.route(1000, FIRST_CALL));
    }

    /** One uid's refusal is its own: it does not change what the pinned host is let through. */
    @Test public void aRefusedUidDoesNotChangeThePinnedHostsAdmission() {
        androidAuto();
        attacker();
        assertEquals(CarGate.Route.FORWARD, gate.route(AUTO_UID, FIRST_CALL));
        assertEquals(CarGate.Route.REFUSE, gate.route(ATTACKER_UID, FIRST_CALL));
        assertEquals(CarGate.Route.FORWARD, gate.route(AUTO_UID, 9));
        assertTrue(gate.decisionFor(AUTO_UID).allowed);
        assertFalse(gate.decisionFor(ATTACKER_UID).allowed);
        assertNull("no decision for a uid that never called", gate.decisionFor(12345));
    }

    /** Checked on every call, so an update or removal of the package, or a new pin, takes effect at once. */
    @Test public void everyCallIsCheckedAgainstWhatIsInstalledNow() {
        androidAuto();
        assertEquals(CarGate.Route.FORWARD, gate.route(AUTO_UID, FIRST_CALL));
        facts.certs.put(AUTO, OTHER_CERT);
        assertEquals("re-signed: refused", CarGate.Route.REFUSE, gate.route(AUTO_UID, FIRST_CALL));
        facts.certs.put(AUTO, AUTO_CERT);
        facts.byUid.remove(AUTO_UID);
        assertEquals("uninstalled: refused", CarGate.Route.REFUSE, gate.route(AUTO_UID, FIRST_CALL));
        androidAuto();
        pins.clear();
        assertEquals("unpinned: refused", CarGate.Route.REFUSE, gate.route(AUTO_UID, FIRST_CALL));
    }

    /** As ControllerPolicy: a shared uid is let through as the package the uid owns, and only by that package's pin. */
    @Test public void aSharedUidIsJudgedByAndroidAutosPackageAmongItsPackages() {
        androidAuto();
        facts.byUid.put(AUTO_UID, new String[] { "com.example.sibling", AUTO });
        assertEquals(CarGate.Route.FORWARD, gate.route(AUTO_UID, FIRST_CALL));
        facts.byUid.put(ATTACKER_UID, new String[] { "com.example.one", "com.example.two" });
        pins.put("com.example.one", OTHER_CERT);
        facts.certs.put("com.example.one", OTHER_CERT);
        assertEquals("a pinned package that is not Android Auto is still refused", CarGate.Route.REFUSE, gate.route(ATTACKER_UID, FIRST_CALL));
    }

    /** A refusal is logged with what to pin, at most once a minute per uid, so a caller cannot flood the log. */
    @Test public void aRefusalIsLoggedOnceAMinutePerUid() {
        facts.byUid.put(AUTO_UID, new String[] { AUTO });
        facts.certs.put(AUTO, AUTO_CERT);
        attacker();
        gate.route(AUTO_UID, FIRST_CALL);
        String line = gate.takeLogLine(AUTO_UID);
        assertTrue(line, line.endsWith("To allow it, add " + AUTO + "=" + AUTO_CERT + " to car.hostPins"));
        gate.route(AUTO_UID, FIRST_CALL);
        assertNull(gate.takeLogLine(AUTO_UID));
        gate.route(ATTACKER_UID, FIRST_CALL);
        assertNotNull("another uid has its own minute", gate.takeLogLine(ATTACKER_UID));
        now += 61_000;
        gate.route(AUTO_UID, FIRST_CALL);
        assertNotNull(gate.takeLogLine(AUTO_UID));
    }
}
