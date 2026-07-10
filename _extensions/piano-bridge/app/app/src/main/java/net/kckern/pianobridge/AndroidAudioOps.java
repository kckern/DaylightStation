package net.kckern.pianobridge;

import android.content.Context;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;

/**
 * AndroidAudioOps — the real Ops. Note the API-29 constraint: there is NO public
 * way to query the ACTIVE output route (getDevicesForAttributes is @SystemApi
 * until API 31). We infer the built-in speaker is active iff neither an A2DP nor
 * a wired output device is connected. Sound for a tablet sealed in an antitheft
 * box with no headphone access. Verified against `dumpsys audio` ground truth.
 */
public final class AndroidAudioOps implements AudioRouteGuard.Ops {

    private final AudioManager am;
    private final A2dpConnector a2dp;
    private final PianoEngine engine;

    public AndroidAudioOps(Context ctx, A2dpConnector a2dp, PianoEngine engine) {
        this.am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
        this.a2dp = a2dp;
        this.engine = engine;
    }

    @Override public boolean a2dpProfileConnected() {
        return a2dp != null && a2dp.isTargetConnected();
    }

    @Override public boolean a2dpOutputPresent() {
        return hasType(AudioDeviceInfo.TYPE_BLUETOOTH_A2DP);
    }

    /**
     * Any non-A2DP, non-built-in output. AudioGuardPolicy suppresses the volume clamp
     * when this is true, because setStreamVolume would then write THAT device's index
     * instead of the speaker's. Under-reporting here zeroes the wrong device's volume,
     * so err on the side of listing a type.
     */
    @Override public boolean wiredOutputPresent() {
        return hasType(AudioDeviceInfo.TYPE_WIRED_HEADSET)
            || hasType(AudioDeviceInfo.TYPE_WIRED_HEADPHONES)
            || hasType(AudioDeviceInfo.TYPE_USB_HEADSET)
            || hasType(AudioDeviceInfo.TYPE_USB_DEVICE)
            || hasType(AudioDeviceInfo.TYPE_USB_ACCESSORY)
            || hasType(AudioDeviceInfo.TYPE_LINE_ANALOG)
            || hasType(AudioDeviceInfo.TYPE_LINE_DIGITAL)
            || hasType(AudioDeviceInfo.TYPE_AUX_LINE)
            || hasType(AudioDeviceInfo.TYPE_HDMI)
            || hasType(AudioDeviceInfo.TYPE_DOCK);
    }

    @Override public int speakerMusicIndex() {
        // No per-device getter on API 29. While the speaker is the active route this
        // returns the speaker's index, which is exactly when the policy consults it.
        return am == null ? 0 : am.getStreamVolume(AudioManager.STREAM_MUSIC);
    }

    @Override public void clampSpeakerMusicVolume() {
        if (am == null) return;
        // Writes the index of the ACTIVE device. The policy only sets clamp=true when
        // the speaker is the inferred active route, so this cannot clamp the piano.
        am.setStreamVolume(AudioManager.STREAM_MUSIC, 0, 0);
    }

    @Override public void setSynthGate(boolean open) {
        if (engine == null) return;
        engine.setOutputGate(open);
        // Reopening is the reconciler's job now: onErrorAfterClose deliberately leaves
        // the stream closed after an A2DP drop. start() is natively idempotent, and we
        // only call it once the route is re-confirmed, so this cannot reopen onto the
        // built-in speaker.
        if (open && !engine.isStreamRunning()) engine.start();
    }

    private boolean hasType(int type) {
        if (am == null) return false;
        for (AudioDeviceInfo d : am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
            if (d.getType() == type) return true;
        }
        return false;
    }
}
