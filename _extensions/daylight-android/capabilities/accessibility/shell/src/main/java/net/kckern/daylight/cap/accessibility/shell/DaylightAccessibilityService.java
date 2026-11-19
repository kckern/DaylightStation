package net.kckern.daylight.cap.accessibility.shell;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.view.KeyEvent;
import android.view.accessibility.AccessibilityEvent;

import net.kckern.daylight.api.AccessibilityDelegate;
import net.kckern.daylight.api.AccessibilityHost;
import net.kckern.daylight.api.DelegateSlot;
import net.kckern.daylight.api.ShellComponents;

/**
 * The APK's accessibility service. It decides nothing: every event goes to the
 * payload's delegate. With no delegate, keys pass through untouched.
 */
public class DaylightAccessibilityService extends AccessibilityService implements AccessibilityHost {
    public static final String COMPONENT = "accessibility";
    private static final String SHELL_SERVICE = "net.kckern.daylight.shell.ShellService";

    private final DelegateSlot<AccessibilityDelegate> delegate = new DelegateSlot<>();

    @Override public void setDelegate(AccessibilityDelegate d) { delegate.set(d); }
    @Override public boolean clearDelegate(AccessibilityDelegate expected) { return delegate.clear(expected); }

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        // Android can bind this service in a process where the shell service is not
        // running (after a force-stop, for one). Starting it again is harmless.
        try {
            startForegroundService(new Intent().setClassName(this, SHELL_SERVICE));
        } catch (Exception ignored) { }
        ShellComponents.publish(COMPONENT, this);
    }

    @Override
    protected boolean onKeyEvent(KeyEvent event) {
        AccessibilityDelegate d = delegate.get();
        try {
            return d != null && d.onKeyEvent(event);
        } catch (Throwable t) {
            return false;
        }
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        AccessibilityDelegate d = delegate.get();
        if (d == null) return;
        try { d.onAccessibilityEvent(event); } catch (Throwable ignored) { }
    }

    @Override public void onInterrupt() { }

    @Override
    public boolean onUnbind(Intent intent) {
        delegate.set(null);
        ShellComponents.publish(COMPONENT, null);
        return super.onUnbind(intent);
    }

    @Override
    public void onDestroy() {
        delegate.set(null);
        ShellComponents.publish(COMPONENT, null);
        super.onDestroy();
    }
}
