package net.kckern.daylight.core;

import org.json.JSONObject;
import org.junit.Test;

import static org.junit.Assert.*;

public class AccessibilitySettingsTest {
    private static final String COMPONENT = "test/service";

    private static final class Settings implements SettingsControl.AccessibilitySettings {
        boolean allowed = true, acceptService = true, acceptGlobal = true, stopAfterService;
        int serviceWrites, globalWrites;

        public String enabledServices() { return "existing/service"; }

        public boolean writeEnabledServices(String value) {
            assertEquals("existing/service:" + COMPONENT, value);
            serviceWrites++;
            if (stopAfterService) allowed = false;
            return acceptService;
        }

        public boolean writeAccessibilityEnabled() {
            globalWrites++;
            return acceptGlobal;
        }

        JSONObject enable() {
            return SettingsControl.enableAccessibilityService(this, COMPONENT, () -> allowed);
        }
    }

    private void assertFailure(Settings settings, String error, int serviceWrites, int globalWrites) throws Exception {
        JSONObject result = settings.enable();
        assertFalse(result.getBoolean("ok"));
        assertEquals(COMPONENT, result.getString("component"));
        assertEquals(error, result.getString("error"));
        assertEquals(serviceWrites, settings.serviceWrites);
        assertEquals(globalWrites, settings.globalWrites);
    }

    @Test public void stopBeforeFirstWritePreservesBothSettings() throws Exception {
        Settings settings = new Settings();
        settings.allowed = false;
        assertFailure(settings, "native_safety_unavailable_or_stopped", 0, 0);
    }

    @Test public void stopAfterFirstWritePreventsGlobalEnable() throws Exception {
        Settings settings = new Settings();
        settings.stopAfterService = true;
        assertFailure(settings, "native_safety_unavailable_or_stopped", 1, 0);
    }

    @Test public void refusedServiceListWritePreventsGlobalEnable() throws Exception {
        Settings settings = new Settings();
        settings.acceptService = false;
        assertFailure(settings, "enabled_services_write_rejected", 1, 0);
    }

    @Test public void refusedGlobalEnableIsReported() throws Exception {
        Settings settings = new Settings();
        settings.acceptGlobal = false;
        assertFailure(settings, "accessibility_enabled_write_rejected", 1, 1);
    }

    @Test public void bothAcceptedWritesReportSuccess() throws Exception {
        Settings settings = new Settings();
        JSONObject result = settings.enable();
        assertTrue(result.getBoolean("ok"));
        assertEquals(COMPONENT, result.getString("component"));
        assertEquals(1, settings.serviceWrites);
        assertEquals(1, settings.globalWrites);
    }
}
