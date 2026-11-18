package net.kckern.daylight.shellkit;

import static org.junit.Assert.*;

import android.content.ComponentName;
import android.content.ContextWrapper;
import android.content.Intent;

import org.junit.Test;

public class ShellStartTest {
    private static final class Ctx extends ContextWrapper {
        int starts;
        RuntimeException refusal;
        Ctx() { super(null); }
        @Override public String getPackageName() { return "net.kckern.daylight.test"; }
        @Override public ComponentName startForegroundService(Intent service) {
            starts++;
            if (refusal != null) throw refusal;
            return null;
        }
    }

    @Test public void asksAndroidToStartTheShellServiceOnce() {
        Ctx ctx = new Ctx();
        assertTrue(ShellStart.ensure(ctx));
        assertEquals(1, ctx.starts);
    }

    @Test public void aRefusedStartIsFalseAndNeverAnException() {
        // From Android 12 a foreground service cannot be started from the background.
        Ctx ctx = new Ctx();
        ctx.refusal = new IllegalStateException("not allowed to start a foreground service from the background");
        assertFalse(ShellStart.ensure(ctx));
        ctx.refusal = new SecurityException("no");
        assertFalse(ShellStart.ensure(ctx));
        assertEquals(2, ctx.starts);
    }

    @Test public void namesTheShellServiceByClassName() {
        assertEquals("net.kckern.daylight.shell.ShellService", ShellStart.SERVICE);
    }
}
