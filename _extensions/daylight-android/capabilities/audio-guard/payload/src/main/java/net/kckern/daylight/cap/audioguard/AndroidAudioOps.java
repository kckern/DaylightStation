package net.kckern.daylight.cap.audioguard;

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
    private final java.util.function.Supplier<net.kckern.daylight.core.spi.OutputGate> gate;

    public AndroidAudioOps(Context ctx, A2dpConnector a2dp,
                           java.util.function.Supplier<net.kckern.daylight.core.spi.OutputGate> gate) {
        this.am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
        this.a2dp = a2dp;
        this.gate = gate;
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

    @Override public int musicMaxIndex() {
        return am == null ? 0 : am.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
    }

    @Override public boolean raiseA2dpMusicVolume() {
        if (am == null) return false;
        // Re-sense at the write: the policy's view is up to a reconcile old.
        if (!a2dpProfileConnected() || !a2dpOutputPresent() || wiredOutputPresent()) return false;
        am.setStreamVolume(AudioManager.STREAM_MUSIC, am.getStreamMaxVolume(AudioManager.STREAM_MUSIC), 0);
        // If A2DP dropped across the write, the raise may have landed on the built-in
        // speaker. Clamp the now-active device back to 0. If it dropped just AFTER the
        // write, this writes the speaker's index, which is already 0 — harmless.
        if (!a2dpOutputPresent()) {
            am.setStreamVolume(AudioManager.STREAM_MUSIC, 0, 0);
            return false;
        }
        return true;
    }

    @Override public void clampSpeakerMusicVolume() {
        if (am == null) return;
        // Writes the index of the ACTIVE device. The policy only sets clamp=true when
        // the speaker is the inferred active route, so this cannot clamp the piano.
        am.setStreamVolume(AudioManager.STREAM_MUSIC, 0, 0);
    }

    @Override public void setSynthGate(boolean open) {
        // The gate itself (and reopening the stream for a synth the kiosk asked for) is
        // the synth's business now: SynthHost.setOpen carries the lines that were here.
        net.kckern.daylight.core.spi.OutputGate g = gate.get();
        if (g != null) g.setOpen(open);
    }

    private boolean hasType(int type) {
        if (am == null) return false;
        for (AudioDeviceInfo d : am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
            if (d.getType() == type) return true;
        }
        return false;
    }
}
