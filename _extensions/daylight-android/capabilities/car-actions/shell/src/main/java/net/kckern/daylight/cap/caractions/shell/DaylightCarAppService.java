package net.kckern.daylight.cap.caractions.shell;

import android.content.Intent;
import android.os.Binder;
import android.util.Log;

import androidx.car.app.CarAppService;
import androidx.car.app.HostInfo;
import androidx.car.app.Screen;
import androidx.car.app.Session;
import androidx.car.app.validation.HostValidator;

import net.kckern.daylight.shellkit.AndroidPackageFacts;
import net.kckern.daylight.shellkit.ShellStart;
import net.kckern.daylight.shellkit.SignerPins;
import net.kckern.daylight.shellkit.SurfaceCache;

/**
 * The car screen's service: the Car App Library's CarAppService, whose session and
 * screens draw the templates the car shows. Android creates it by class name, possibly
 * in a process whose payload is not loaded; every question about the list goes to the
 * payload over the "car" port.
 *
 * Not exported. Android Auto binds CarHostGateService, which lets a transaction
 * through to this service's binder, in process, only when the transaction's own
 * calling uid is the pinned Android Auto (CarGate). That gate is what holds every
 * call; this class keeps two further checks behind it. createHostValidator runs on
 * the binder thread of the host's handshake (so Binder.getCallingUid() is the host's
 * uid), records CarHostPolicy's decision for that uid, and hands the library's
 * validator that one host and its pinned digest, or none. The screens check
 * servesHost() before drawing or acting, against the decision for the uid the library
 * settled on. The library's "allow every host in a debuggable build" shortcut and
 * ALLOW_ALL_HOSTS_VALIDATOR are not used.
 */
public class DaylightCarAppService extends CarAppService {
    static final String TAG = "Daylight-Car";
    /** The surface cache key the payload writes car.hostPins into (CarActionsCapability.HOST_PINS). */
    static final String PIN_KEY = "car.hostPins";

    /** The decision for each uid that completed a handshake. One uid's refusal never touches another's. */
    private final java.util.Map<Integer, CarHostPolicy.Decision> decisions = new java.util.concurrent.ConcurrentHashMap<>();

    @Override
    public void onCreate() {
        super.onCreate();
        // Loads the payload in a cold process. Android may refuse from the background; the
        // screen then says Daylight is starting until a payload attaches.
        ShellStart.ensure(this);
    }

    @Override
    public HostValidator createHostValidator() {
        CarHostPolicy.Decision d = CarHostPolicy.decide(Binder.getCallingUid(), new AndroidPackageFacts(getPackageManager()),
                SignerPins.fromCache(SurfaceCache.get(this, PIN_KEY)));
        decisions.put(d.uid, d);
        HostValidator.Builder validator = new HostValidator.Builder(this);
        if (d.allowed) {
            validator.addAllowedHost(CarHostPolicy.ANDROID_AUTO, d.pinnedDigest);
        } else {
            Log.w(TAG, d.logLine());
        }
        return validator.build();
    }

    /** True when the host the library settled on is the one CarHostPolicy allowed. */
    boolean servesHost() {
        HostInfo host;
        try {
            host = getHostInfo();
        } catch (RuntimeException notYet) {
            return false;
        }
        return host != null && CarHostPolicy.serves(decisions.get(host.getUid()), host.getPackageName(), host.getUid());
    }

    @Override
    public Session onCreateSession() {
        return new Session() {
            @Override public Screen onCreateScreen(Intent intent) {
                return new ActionsScreen(getCarContext(), DaylightCarAppService.this);
            }
        };
    }
}
