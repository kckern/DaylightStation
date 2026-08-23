package net.kckern.pianobridge.payload;

import android.accessibilityservice.AccessibilityService;
import android.util.Log;

import net.kckern.pianobridge.A11y;
import net.kckern.pianobridge.BridgeCore;
import net.kckern.pianobridge.api.Payload;
import net.kckern.pianobridge.api.ShellServices;

/**
 * Main — the payload's entry point. The shell looks this class up BY NAME
 * ({@code net.kckern.pianobridge.payload.Main}) after loading the payload dex and
 * drives it through the {@link Payload} contract. Everything else is BridgeCore.
 */
public final class Main implements Payload {

    private static final String TAG = "PianoBridge";
    private static final String VERSION = "p13-os-verdicts";

    private BridgeCore core;

    public Main() { }

    @Override
    public void start(ShellServices shell) {
        // A hot swap happens while the a11y service is ALREADY bound, so the shell's
        // onAccessibilityConnected forward never fires for this payload. Adopt the
        // live instance now; the forward still covers a bind that happens later.
        Object svc = shell.accessibilityService();
        if (svc instanceof AccessibilityService) A11y.bind((AccessibilityService) svc);
        core = new BridgeCore(shell);
        core.start();
    }

    @Override
    public void stop() {
        if (core != null) {
            try { core.stop(); } catch (Throwable t) { Log.w(TAG, "payload stop threw", t); }
            core = null;
        }
        // Drop our reference to the shell's a11y service so a swapped-out payload
        // can be collected and cannot dispatch gestures from beyond the grave.
        A11y.unbind();
    }

    @Override
    public String version() { return VERSION; }

    @Override
    public void onAccessibilityConnected(Object svc) {
        A11y.bind((AccessibilityService) svc);
    }

    @Override
    public void onAccessibilityDisconnected() {
        A11y.unbind();
    }
}
