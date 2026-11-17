package net.kckern.pianobridge;
import org.junit.Test;
import static org.junit.Assert.*;
import java.lang.reflect.Proxy;
import net.kckern.pianobridge.api.ShellServices;

public class StartupAccessibilityTest {
    static class SettingsSink implements SettingsControl.AccessibilitySettings {
        int reads, writes;
        Runnable afterWrite=() -> {};
        public String enabledServices() { reads++; return "existing/service"; }
        public boolean writeEnabledServices(String value) { writes++; afterWrite.run(); return true; }
        public boolean writeAccessibilityEnabled() { writes++; afterWrite.run(); return true; }
    }
    private BridgeCore core(ShellServices.SafetyState[] state) {
        ShellServices shell=(ShellServices)Proxy.newProxyInstance(getClass().getClassLoader(),new Class[]{ShellServices.class},
            (p,m,a) -> m.getName().equals("nativeSafety") ? state[0] : null);
        return new BridgeCore(shell);
    }
    @Test public void unknownOrStoppedStartupDoesNotWriteSecureSettings() {
        for (ShellServices.SafetyState state:new ShellServices.SafetyState[]{ShellServices.SafetyState.UNKNOWN,
                new ShellServices.SafetyState(true,true,5,100)}) {
            SettingsSink settings=new SettingsSink();
            core(new ShellServices.SafetyState[]{state}).enableStartupAccessibility("piano/service",settings);
            assertEquals("passive read remains available",1,settings.reads);
            assertEquals("startup must not enable accessibility without authority",0,settings.writes);
        }
    }
    @Test public void knownRunAuthorityPermitsStartupSettings() {
        SettingsSink settings=new SettingsSink();
        core(new ShellServices.SafetyState[]{new ShellServices.SafetyState(true,false,5,100)})
                .enableStartupAccessibility("piano/service",settings);
        assertEquals(2,settings.writes);
    }
    @Test public void stopBetweenSecureWritesPreventsSecondWrite() {
        ShellServices.SafetyState[] state={new ShellServices.SafetyState(true,false,5,100)};
        SettingsSink settings=new SettingsSink();
        settings.afterWrite=() -> state[0]=new ShellServices.SafetyState(true,true,6,100);
        core(state).enableStartupAccessibility("piano/service",settings);
        assertEquals(1,settings.writes);
    }
}
