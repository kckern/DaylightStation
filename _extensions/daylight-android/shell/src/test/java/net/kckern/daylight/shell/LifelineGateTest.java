package net.kckern.daylight.shell;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class LifelineGateTest {

    private static void refused(int status, String error, LifelineGate.Refusal r) {
        assertEquals(status, r.status);
        assertEquals(error, r.error);
    }

    @Test
    public void statusNeedsNoLoader() {
        assertNull(LifelineGate.check("/", false, "GET", false, false));
        assertNull(LifelineGate.check("/status", false, "GET", false, false));
        assertNull(LifelineGate.check("/log", false, "GET", false, false));
    }

    @Test
    public void payloadRoutesAre503UntilTheLoaderIsReady() {
        refused(503, "loader not ready", LifelineGate.check("/payload", false, "GET", false, false));
        refused(503, "loader not ready", LifelineGate.check("/payload", false, "POST", true, true));
        refused(503, "loader not ready", LifelineGate.check("/payload/rollback", false, "POST", false, false));
        refused(503, "loader not ready", LifelineGate.check("/restart", false, "POST", false, false));
    }

    @Test
    public void rollbackAndRestartArePostOnly() {
        refused(405, "POST only", LifelineGate.check("/payload/rollback", true, "GET", false, false));
        refused(405, "POST only", LifelineGate.check("/restart", true, "GET", false, false));
        refused(405, "POST only", LifelineGate.check("/restart", true, "DELETE", false, false));
        assertNull(LifelineGate.check("/payload/rollback", true, "POST", false, false));
        assertNull(LifelineGate.check("/restart", true, "POST", false, false));
    }

    @Test
    public void swapNeedsBothUrlAndSha256() {
        refused(400, "url and sha256 required", LifelineGate.check("/payload", true, "POST", false, false));
        refused(400, "url and sha256 required", LifelineGate.check("/payload", true, "POST", true, false));
        refused(400, "url and sha256 required", LifelineGate.check("/payload", true, "POST", false, true));
        assertNull(LifelineGate.check("/payload", true, "POST", true, true));
    }

    @Test
    public void payloadStatusIsAPlainGet() {
        assertNull(LifelineGate.check("/payload", true, "GET", false, false));
    }

    @Test
    public void unknownRoutesAreLeftToTheServer() {
        assertNull(LifelineGate.check("/nope", false, "GET", false, false));
    }

    @Test
    public void aRefusalFromTheLoaderIs409WithItsReason() {
        refused(409, "no previous payload", LifelineGate.refusalOf("refused: no previous payload"));
        refused(409, "no current payload", LifelineGate.refusalOf("refused: no current payload"));
        refused(409, "sha256 must be 64 hex characters", LifelineGate.refusalOf("refused: sha256 must be 64 hex characters"));
        refused(409, "refused", LifelineGate.refusalOf(null));
    }

    @Test
    public void anAcceptedRequestIsNotARefusal() {
        assertNull(LifelineGate.refusalOf("accepted: rolling back to p0-baked-v1.jar"));
        assertNull(LifelineGate.refusalOf("accepted: fetching http://192.0.2.10/refused: x.jar"));
    }
}
