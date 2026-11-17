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
 * The car screen's service: Android Auto binds it and shows the templates its session's
 * screens draw. Android creates it by class name, possibly in a process whose payload
 * is not loaded; every question about the list goes to the payload over the "car" port.
 *
 * Exported, because Android Auto must bind it. Who is served is CarHostPolicy's
 * decision, made in createHostValidator: the library calls it on the binder thread of
 * the host's handshake, so Binder.getCallingUid() there is the host's own uid. The
 * library's validator is then given that one host and its pinned digest, or none; and
 * the screens also check the decision, because the library's validator would accept a
 * package holding the TEMPLATE_RENDERER permission, which this check does not.
 * The debug shortcut that allows every host in a debuggable build is not used.
 */
public class DaylightCarAppService extends CarAppService {
    static final String TAG = "Daylight-Car";
    /** The surface cache key the payload writes car.hostPins into (CarActionsCapability.HOST_PINS). */
    static final String PIN_KEY = "car.hostPins";

    private volatile CarHostPolicy.Decision decision;

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
        decision = d;
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
        return host != null && CarHostPolicy.serves(decision, host.getPackageName(), host.getUid());
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
