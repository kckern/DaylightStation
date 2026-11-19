package net.kckern.daylight.shell;

import static org.junit.Assert.*;

import org.junit.Test;

import java.security.SecureRandom;

public class ControlTokenTest {
    private static final String COMPILED = "0123456789abcdef0123456789abcdef";

    @Test public void aDeviceThatListensUsesItsCompiledToken() {
        assertEquals(COMPILED, ControlToken.forBind("lan", COMPILED, new SecureRandom()));
        assertEquals(COMPILED, ControlToken.forBind("loopback", COMPILED, new SecureRandom()));
    }

    @Test public void aDeviceThatListensNowhereGetsATokenNobodyCanPresent() {
        String a = ControlToken.forBind("none", "", new SecureRandom());
        String b = ControlToken.forBind("none", "", new SecureRandom());
        assertEquals("long enough for the payload's router to accept as a token", 64, a.length());
        assertNotEquals("made up per process", a, b);
        assertNotEquals("and never the compiled value, even if one were there", COMPILED, ControlToken.forBind("none", COMPILED, new SecureRandom()));
    }

    @Test public void thisBuildCompilesATokenOnlyIfItListens() {
        // Runs once per device. The phone's APK holds no control token: any app on a
        // phone can read another app's APK.
        boolean listens = net.kckern.daylight.api.ControlBind.listens(BuildConfig.CONTROL_BIND);
        assertEquals("device " + BuildConfig.DEVICE_ID + " bind " + BuildConfig.CONTROL_BIND,
                listens, BuildConfig.CONTROL_TOKEN.length() >= 32);
        if (!listens) assertEquals("", BuildConfig.CONTROL_TOKEN);
    }
}
