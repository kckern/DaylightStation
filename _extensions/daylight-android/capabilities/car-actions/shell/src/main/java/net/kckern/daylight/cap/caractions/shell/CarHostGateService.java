package net.kckern.daylight.cap.caractions.shell;

import android.app.Service;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.Binder;
import android.os.IBinder;
import android.os.Parcel;
import android.os.RemoteException;
import android.util.Log;

import net.kckern.daylight.shellkit.AndroidPackageFacts;
import net.kckern.daylight.shellkit.SignerPins;
import net.kckern.daylight.shellkit.SurfaceCache;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

/**
 * The car screen's exported face. Android Auto finds it by the CarAppService action
 * and the IOT category, and binds it. It holds no car logic: it returns a binder that
 * lets a transaction through to the Car App Library's binder only when the uid Binder
 * reports for that transaction is the pinned Android Auto (CarGate), and refuses every
 * other transaction before the library sees it.
 *
 * Why: the library's CarAppService.onBind is final and hands its binder to every
 * client, and only its handshake reads the caller's uid; its later calls (getManager,
 * the template, a row's click) check nobody. Every binder the car screen hands out
 * (the app manager, the templates' click listeners, the microphone's callback) is
 * handed out in answer to an ICarApp call or to the host passed in onAppCreate, so a
 * caller refused here can obtain none of them.
 *
 * The library's binder lives in DaylightCarAppService, which is not exported. It is
 * bound here, in process, with the client's own intent (its SessionInfo is in the
 * extras), on the first transaction that is let through, and unbound when the client
 * unbinds. A forwarded transaction runs on the same binder thread, so the library still
 * sees the host's own uid in Binder.getCallingUid() at its handshake.
 */
public class CarHostGateService extends Service {
    /** How long a let-through transaction waits for the in-process bind. */
    private static final long BIND_WAIT_MS = 10_000;

    private CarGate gate;
    private final List<Gate> gates = new ArrayList<>();

    @Override
    public void onCreate() {
        super.onCreate();
        final Context app = getApplicationContext();
        gate = new CarGate(new AndroidPackageFacts(getPackageManager()),
                () -> SignerPins.fromCache(SurfaceCache.get(app, DaylightCarAppService.PIN_KEY)), System::currentTimeMillis);
    }

    @Override
    public IBinder onBind(Intent intent) {
        // Called by the system on the main thread, so the caller cannot be told here:
        // each transaction is judged by its own calling uid.
        Gate g = new Gate(new Intent(intent).setComponent(new ComponentName(this, DaylightCarAppService.class)));
        synchronized (gates) { gates.add(g); }
        return g;
    }

    @Override
    public boolean onUnbind(Intent intent) {
        // Android calls this once every client of this interface (intent) has gone,
        // Android Auto included when it dies.
        synchronized (gates) {
            for (Iterator<Gate> it = gates.iterator(); it.hasNext(); ) {
                Gate g = it.next();
                if (g.target.filterEquals(new Intent(intent).setComponent(g.target.getComponent()))) {
                    g.release();
                    it.remove();
                }
            }
        }
        return false;
    }

    @Override
    public void onDestroy() {
        synchronized (gates) {
            for (Gate g : gates) g.release();
            gates.clear();
        }
        super.onDestroy();
    }

    /** One client interface: the gate in front of one in-process binding of the library's service. */
    private final class Gate extends Binder implements ServiceConnection {
        final Intent target;
        private final Object lock = new Object();
        private IBinder real;
        private boolean bound;
        private boolean released;

        Gate(Intent target) { this.target = target; }

        @Override
        protected boolean onTransact(int code, Parcel data, Parcel reply, int flags) throws RemoteException {
            int uid = Binder.getCallingUid();
            if (gate.route(uid, code) != CarGate.Route.FORWARD) {
                String line = gate.takeLogLine(uid);
                if (line != null) Log.w(DaylightCarAppService.TAG, line);
                // Unknown transaction: the caller gets nothing, not even the descriptor.
                return false;
            }
            IBinder r = awaitReal();
            if (r == null) {
                Log.w(DaylightCarAppService.TAG, "car screen not ready; a host call was dropped");
                return false;
            }
            // In process: Binder.transact runs the library's onTransact on this thread,
            // with the parcels as they came.
            return r.transact(code, data, reply, flags);
        }

        private IBinder awaitReal() {
            synchronized (lock) {
                if (released) return null;
                if (!bound) {
                    bound = bindService(target, this, Context.BIND_AUTO_CREATE);
                    if (!bound) return null;
                }
                long deadline = System.currentTimeMillis() + BIND_WAIT_MS;
                while (real == null && !released) {
                    long left = deadline - System.currentTimeMillis();
                    if (left <= 0) return null;
                    try {
                        lock.wait(left);
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                        return null;
                    }
                }
                return real;
            }
        }

        @Override public void onServiceConnected(ComponentName name, IBinder service) {
            synchronized (lock) {
                real = service;
                lock.notifyAll();
            }
        }

        @Override public void onServiceDisconnected(ComponentName name) {
            synchronized (lock) { real = null; }
        }

        @Override public void onNullBinding(ComponentName name) {
            Log.w(DaylightCarAppService.TAG, "the car screen gave no binder");
            release();
        }

        @Override public void onBindingDied(ComponentName name) {
            release();
        }

        void release() {
            boolean wasBound;
            synchronized (lock) {
                released = true;
                real = null;
                wasBound = bound;
                bound = false;
                lock.notifyAll();
            }
            if (wasBound) {
                try {
                    unbindService(this);
                } catch (RuntimeException notBound) {
                    // Already gone.
                }
            }
        }
    }
}
