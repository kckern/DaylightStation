package net.kckern.daylight.cap.caractions.shell;

import android.app.Service;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.net.Uri;
import android.os.Binder;
import android.os.Build;
import android.os.IBinder;
import android.os.Parcel;
import android.os.RemoteException;
import android.util.Log;

import androidx.car.app.CarAppService;
import androidx.car.app.SessionInfo;
import androidx.car.app.SessionInfoIntentEncoder;

import net.kckern.daylight.shellkit.AndroidPackageFacts;
import net.kckern.daylight.shellkit.SignerPins;
import net.kckern.daylight.shellkit.SurfaceCache;

import java.util.ArrayList;
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
 * bound here, in process, on the first transaction that is let through, with an intent
 * built from the binding's own session key (CarSessionKey): never with a client's
 * extras, which Android does not compare between clients. It is unbound when the
 * clients unbind, and bound again if Android hands the same gate binder back.
 * A forwarded transaction runs on the same binder thread, so the library still sees
 * the host's own uid in Binder.getCallingUid() at its handshake.
 */
public class CarHostGateService extends Service {
    /** How long a let-through transaction waits for the in-process bind. */
    private static final long BIND_WAIT_MS = 10_000;
    /** Gates kept for cleanup; an unbound one beyond this is forgotten (it binds again when used). */
    private static final int MAX_GATES = 32;

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
        synchronized (gates) {
            for (Gate g : gates) if (g.key.filterEquals(intent)) return g;
            if (gates.size() >= MAX_GATES) {
                for (int i = gates.size() - 1; i >= 0 && gates.size() >= MAX_GATES; i--) {
                    if (!gates.get(i).link.bound()) gates.remove(i);
                }
            }
            Gate g = new Gate(new Intent(intent).replaceExtras((android.os.Bundle) null), inner(intent));
            gates.add(g);
            return g;
        }
    }

    /**
     * The intent the library's service is bound with: its component, and the session the
     * binding names in its identifier (Android 10 and later) or data, encoded by the
     * library's own encoder. With no such key the library's default session applies.
     */
    private Intent inner(Intent client) {
        Intent inner = new Intent(CarAppService.SERVICE_INTERFACE).setComponent(new ComponentName(this, DaylightCarAppService.class));
        String key = null;
        if (Build.VERSION.SDK_INT >= 29) key = client.getIdentifier();
        if (key == null) {
            Uri data = client.getData();
            key = data == null ? null : data.getPath();
        }
        CarSessionKey session = CarSessionKey.parse(key);
        if (session != null) SessionInfoIntentEncoder.encode(new SessionInfo(session.displayType, session.sessionId), inner);
        return inner;
    }

    @Override
    public boolean onUnbind(Intent intent) {
        // Android calls this once every client of this interface (intent) has gone,
        // Android Auto included when it dies. The gate stays: Android may hand it back.
        synchronized (gates) {
            for (Gate g : gates) if (g.key.filterEquals(intent)) g.link.release();
        }
        return false;
    }

    @Override
    public void onDestroy() {
        synchronized (gates) {
            for (Gate g : gates) g.link.release();
            gates.clear();
        }
        super.onDestroy();
    }

    /** One client interface: the gate in front of one in-process binding of the library's service. */
    private final class Gate extends Binder implements ServiceConnection {
        /** The client intent with no extras: what Android compares to find this binding. */
        final Intent key;
        final GateLink<IBinder> link;

        Gate(Intent key, final Intent target) {
            this.key = key;
            this.link = new GateLink<>(new GateLink.Binding() {
                @Override public boolean bind() { return bindService(target, Gate.this, Context.BIND_AUTO_CREATE); }
                @Override public void unbind() {
                    try {
                        unbindService(Gate.this);
                    } catch (RuntimeException notBound) {
                        // Already gone.
                    }
                }
            });
        }

        @Override
        protected boolean onTransact(int code, Parcel data, Parcel reply, int flags) throws RemoteException {
            int uid = Binder.getCallingUid();
            if (gate.route(uid, code) != CarGate.Route.FORWARD) {
                String line = gate.takeLogLine(uid);
                if (line != null) Log.w(DaylightCarAppService.TAG, line);
                // Unknown transaction: the caller gets nothing, not even the descriptor.
                return false;
            }
            IBinder r = link.await(BIND_WAIT_MS);
            if (r == null) {
                Log.w(DaylightCarAppService.TAG, "car screen not ready; a host call was dropped");
                return false;
            }
            // In process: Binder.transact runs the library's onTransact on this thread,
            // with the parcels as they came.
            return r.transact(code, data, reply, flags);
        }

        @Override public void onServiceConnected(ComponentName name, IBinder service) { link.connected(service); }

        @Override public void onServiceDisconnected(ComponentName name) { link.disconnected(); }

        @Override public void onNullBinding(ComponentName name) {
            Log.w(DaylightCarAppService.TAG, "the car screen gave no binder");
            link.release();
        }

        @Override public void onBindingDied(ComponentName name) { link.release(); }
    }
}
