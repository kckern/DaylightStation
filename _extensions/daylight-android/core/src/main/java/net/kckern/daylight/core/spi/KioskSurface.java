package net.kckern.daylight.core.spi;

import android.content.Intent;

/** Provided by `webview-host`: the kiosk window and its page. Safe from any thread unless stated. */
public interface KioskSurface {
    interface TouchObserver { void onTouchDown(float x, float y, int width, int height); }
    interface PinCallback { void onPin(String entered); }

    /** An Activity is hosting the page. */
    boolean attached();

    /** The kiosk Activity is resumed. */
    boolean inForeground();

    String currentUrl();

    /** The intent that brings the kiosk Activity to the front. */
    Intent kioskIntent();

    /** Start the kiosk Activity from the service context. May be refused in the background on API 29+. */
    boolean bringToFront();

    /** Start another activity, from the kiosk Activity when it is resumed. */
    boolean startActivity(Intent intent);

    /** Raw evaluateJavascript result (a JSON value as text). Throws TimeoutException. */
    String evaluate(String js, long timeoutMs) throws Exception;

    /** PNG of the WebView's own drawing. */
    byte[] capturePng() throws Exception;

    void setKeepScreenOn(boolean on);

    void setImmersive(boolean on);

    /** startLockTask / stopLockTask on the kiosk Activity. */
    void setLockTask(boolean on);

    /** Called on the main thread for every touch-down on the kiosk window. Null clears. */
    void observeTouches(TouchObserver observer);

    /** Show a native numeric prompt over the page. */
    void promptPin(String title, PinCallback callback);
}
