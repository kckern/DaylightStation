package net.kckern.daylight.cap.bluetoothcontrols;

import static org.junit.Assert.assertEquals;
import org.junit.Test;

public class ConnectPlanTest {

    static final String SPK = "00:00:5E:00:53:01";
    static final String JAM = "00:00:5E:00:53:02";

    @Test public void sameSpeakerAlreadyConnected_isANoOp() {
        // 2026-10-23 18:04: this exact tap rebuilt every connector and dropped a working speaker.
        assertEquals(ConnectPlan.Action.NOOP,
                ConnectPlan.decide("audio", SPK, SPK, true, true, true));
    }

    @Test public void sameSpeakerConfiguredButDown_nudgesWithoutTeardown() {
        assertEquals(ConnectPlan.Action.NUDGE,
                ConnectPlan.decide("audio", SPK, SPK, true, false, true));
    }

    @Test public void differentSpeaker_reloads() {
        assertEquals(ConnectPlan.Action.RELOAD,
                ConnectPlan.decide("audio", "AA:BB:CC:DD:EE:FF", SPK, true, false, true));
    }

    @Test public void sameSpeakerButRoleDisabled_reloadsToReEnable() {
        assertEquals(ConnectPlan.Action.RELOAD,
                ConnectPlan.decide("audio", SPK, SPK, false, false, true));
    }

    @Test public void macComparisonIgnoresCase() {
        assertEquals(ConnectPlan.Action.NOOP,
                ConnectPlan.decide("audio", SPK.toLowerCase(), SPK, true, true, true));
    }

    @Test public void midiFollowsTheSameRules() {
        assertEquals(ConnectPlan.Action.NOOP, ConnectPlan.decide("midi", JAM, JAM, true, true, true));
        assertEquals(ConnectPlan.Action.NUDGE, ConnectPlan.decide("midi", JAM, JAM, true, false, true));
        assertEquals(ConnectPlan.Action.RELOAD, ConnectPlan.decide("midi", JAM, "", true, false, true));
    }

    @Test public void noConnectorToNudge_reloadsInsteadOfSilentlySucceeding() {
        assertEquals(ConnectPlan.Action.RELOAD, ConnectPlan.decide("audio", SPK, SPK, true, false, false));
        assertEquals(ConnectPlan.Action.RELOAD, ConnectPlan.decide("midi", JAM, JAM, true, true, false));
    }
}
