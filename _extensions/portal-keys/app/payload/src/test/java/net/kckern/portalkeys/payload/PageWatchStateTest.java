package net.kckern.portalkeys.payload;
import org.junit.Test;
import static org.junit.Assert.*;
import static net.kckern.portalkeys.payload.PageWatchState.State.*;
import static net.kckern.portalkeys.payload.PageWatchState.Action.*;
public class PageWatchStateTest {
    private final PageWatchState policy=new PageWatchState();
    private PageWatchState.Decision evaluateAt(long now) { return policy.evaluate(now,0,true,false,false); }
    @Test public void awakeSilentPageEscalatesOnlyOncePerStage() {
        PageWatchState.Decision first=evaluateAt(15000);
        assertEquals(DEGRADED, first.state); assertEquals(FOREGROUND_LOAD, first.action);
        assertEquals(NONE,evaluateAt(15000).action);
        assertEquals(NONE,evaluateAt(29999).action);
        assertEquals(RESTART_RENDERER,evaluateAt(30000).action);
        assertEquals(NONE,evaluateAt(30001).action);
    }
    @Test public void sleepStopAndMaintenanceNeverWakeOrRestart() {
        assertEquals(NONE,policy.evaluate(15000,0,false,false,false).action);
        assertEquals(NONE,policy.evaluate(30000,0,true,true,false).action);
        assertEquals(NONE,policy.evaluate(45000,0,true,false,true).action);
        assertEquals(NONE,policy.evaluate(45001,0,true,false,false).action);
    }
    @Test public void restoredCooldownSurvivesServiceRestartAndFreshBeats() {
        policy.restarts.add(1000L);policy.restarts.add(2000L);
        policy.evaluate(15000,0,true,false,false);
        assertEquals(FAILED,policy.evaluate(30000,0,true,false,false).state);
        assertEquals(RECOVERED,policy.evaluate(30001,30001,true,false,false).state);
        policy.evaluate(45001,30001,true,false,false);
        assertEquals(FAILED,policy.evaluate(60001,30001,true,false,false).state);
        PageWatchState reboot=new PageWatchState();reboot.blockedUntil=600000;
        reboot.evaluate(15000,0,true,false,false);
        assertEquals(FAILED,reboot.evaluate(30000,0,true,false,false).state);
    }
    @Test public void capAndNewBeatControlRecovery() {
        evaluateAt(15000); evaluateAt(30000); evaluateAt(45000); evaluateAt(60000);
        evaluateAt(75000);
        PageWatchState.Decision thirdRestartWithin600000=evaluateAt(90000);
        assertFalse(thirdRestartWithin600000.allowed); assertEquals(FAILED,thirdRestartWithin600000.state);
        assertEquals(RECOVERED,policy.evaluate(90001,90001,true,false,false).state);
        assertEquals(HEALTHY,policy.evaluate(90002,90001,true,false,false).state);
    }
}
