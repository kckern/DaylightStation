package net.kckern.daylight.core.testing;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.ContextWrapper;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Handler;

import java.io.File;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * A Context for JVM tests that start a capability for real. It keeps a ledger of
 * what the capability takes from Android, so a test can assert that stop() gives
 * all of it back: every receiver registered is on {@link #receivers} until it is
 * unregistered, and unregistering one that is not registered throws, as Android does.
 *
 * What it cannot do: android.jar's Handler and HandlerThread do nothing on the JVM,
 * so work a capability posts to a Handler never runs. A capability that does its
 * registering inside such a post shows nothing here; those are listed in the
 * reference under "Not covered by JVM tests".
 */
public class FakeContext extends ContextWrapper {
    /** Receivers registered and not yet unregistered. */
    public final List<BroadcastReceiver> receivers = new ArrayList<>();
    /** How many registrations there have been in all. */
    public int registered;
    /** What getSystemService(name) answers. Absent names answer null, as on a device without that service. */
    public final Map<String, Object> services = new HashMap<>();
    private final File dir;

    public FakeContext(File dir) {
        super(null);
        this.dir = dir;
    }

    @Override public Context getApplicationContext() { return this; }
    @Override public String getPackageName() { return "net.kckern.daylight.test"; }
    @Override public Object getSystemService(String name) { return services.get(name); }
    @Override public File getCacheDir() { return sub("cache"); }
    @Override public File getFilesDir() { return sub("files"); }
    @Override public File getExternalFilesDir(String type) { return sub("external"); }

    private File sub(String name) {
        File f = new File(dir, name);
        f.mkdirs();
        return f;
    }

    private synchronized Intent register(BroadcastReceiver receiver) {
        if (receiver != null) { receivers.add(receiver); registered++; }
        return null;
    }

    @Override public Intent registerReceiver(BroadcastReceiver receiver, IntentFilter filter) { return register(receiver); }
    @Override public Intent registerReceiver(BroadcastReceiver receiver, IntentFilter filter, int flags) { return register(receiver); }
    @Override public Intent registerReceiver(BroadcastReceiver receiver, IntentFilter filter, String permission, Handler scheduler) { return register(receiver); }
    @Override public Intent registerReceiver(BroadcastReceiver receiver, IntentFilter filter, String permission, Handler scheduler, int flags) { return register(receiver); }

    @Override public synchronized void unregisterReceiver(BroadcastReceiver receiver) {
        if (!receivers.remove(receiver)) throw new IllegalArgumentException("Receiver not registered: " + receiver);
    }

    /** Live threads with this exact name. For asserting that a capability's thread started and ended. */
    public static int liveThreads(String name) {
        int n = 0;
        for (Thread t : Thread.getAllStackTraces().keySet()) if (t.isAlive() && name.equals(t.getName())) n++;
        return n;
    }
}
