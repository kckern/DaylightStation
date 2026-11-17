package net.kckern.daylight.core;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.view.KeyEvent;
import android.view.accessibility.AccessibilityEvent;

import net.kckern.daylight.api.AccessibilityDelegate;
import net.kckern.daylight.api.AccessibilityHost;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/** Holds the shell's accessibility service for this payload and shares it between capabilities. */
public final class AccessibilityHub implements AccessibilityDelegate {
    public static final String COMPONENT = "accessibility";
    /** The class the `accessibility` capability declares, for enabling it by name. */
    public static final String SERVICE_CLASS = "net.kckern.daylight.cap.accessibility.shell.DaylightAccessibilityService";

    public interface KeyFilter { boolean onKeyEvent(KeyEvent event); }
    public interface EventListener { void onAccessibilityEvent(AccessibilityEvent event); }

    private final List<KeyFilter> keyFilters = new CopyOnWriteArrayList<>();
    private final List<EventListener> listeners = new CopyOnWriteArrayList<>();
    /** Reads and writes a service's info. A seam: the platform's accessors are final, and return nothing on the JVM. */
    interface InfoAccess {
        AccessibilityServiceInfo get(AccessibilityService service);
        void set(AccessibilityService service, AccessibilityServiceInfo info);
    }

    private static final InfoAccess PLATFORM = new InfoAccess() {
        @Override public AccessibilityServiceInfo get(AccessibilityService s) { return s.getServiceInfo(); }
        @Override public void set(AccessibilityService s, AccessibilityServiceInfo info) { s.setServiceInfo(info); }
    };

    private volatile InfoAccess infoAccess = PLATFORM;
    void useInfoAccessForTest(InfoAccess access) { infoAccess = access; }

    private volatile int extraEventTypes;
    private volatile Object bound;

    /** Called with the component when it binds, and with null when it unbinds or the payload stops. */
    public synchronized void bind(Object service) {
        Object previous = bound;
        if (previous != service) release(previous);
        bound = service;
        if (service instanceof AccessibilityHost) ((AccessibilityHost) service).setDelegate(this);
        applyServiceInfo();
    }

    /**
     * Let go of a service this hub was attached to. The service outlives the payload,
     * and during a swap the old payload can stop after the new one has attached, so the
     * hub detaches only itself: if the service has another delegate by now, the
     * delegate and the key-filter flag are the new payload's and are left alone.
     */
    private void release(Object previous) {
        if (!(previous instanceof AccessibilityHost)) return;
        AccessibilityHost host = (AccessibilityHost) previous;
        boolean wasOurs;
        try {
            wasOurs = host.clearDelegate(this);
        } catch (Throwable olderShell) {
            // A shell from before clearDelegate existed: detach the only way it offers.
            host.setDelegate(null);
            wasOurs = true;
        }
        if (wasOurs && previous instanceof AccessibilityService) setKeyFilterFlag((AccessibilityService) previous, false);
    }

    public boolean isBound() { return bound != null; }

    /** How many key filters are registered. */
    public int keyFilterCount() { return keyFilters.size(); }

    /** The live service, for gestures and window content, or null. */
    public AccessibilityService service() {
        Object b = bound;
        return b instanceof AccessibilityService ? (AccessibilityService) b : null;
    }

    /** Filters run in registration order on the service's main thread. Returning true consumes the key. */
    public void addKeyFilter(KeyFilter filter) {
        keyFilters.add(filter);
        applyServiceInfo();
    }

    /** With the last filter gone the service stops asking Android for key events. */
    public void removeKeyFilter(KeyFilter filter) {
        if (keyFilters.remove(filter)) applyServiceInfo();
    }

    public void removeEventListener(EventListener listener) { listeners.remove(listener); }

    /** eventTypes: AccessibilityEvent.TYPE_* bits to add to the declared typeWindowStateChanged. */
    public void addEventListener(int eventTypes, EventListener listener) {
        extraEventTypes |= eventTypes;
        listeners.add(listener);
        applyServiceInfo();
    }

    private void applyServiceInfo() {
        AccessibilityService s = service();
        if (s == null) return;
        try {
            AccessibilityServiceInfo info = infoAccess.get(s);
            if (info == null) return;
            // The declared config does not ask for key events; this hub is the only thing
            // that does, so the flag follows whether a filter is registered.
            info.flags = keyFilterFlag(info.flags, !keyFilters.isEmpty());
            info.eventTypes |= extraEventTypes;
            infoAccess.set(s, info);
        } catch (Throwable ignored) { }
    }

    /** The service-info flags with FLAG_REQUEST_FILTER_KEY_EVENTS set or cleared. */
    static int keyFilterFlag(int flags, boolean wanted) {
        return wanted ? flags | AccessibilityServiceInfo.FLAG_REQUEST_FILTER_KEY_EVENTS
                : flags & ~AccessibilityServiceInfo.FLAG_REQUEST_FILTER_KEY_EVENTS;
    }

    private void setKeyFilterFlag(AccessibilityService s, boolean wanted) {
        try {
            AccessibilityServiceInfo info = infoAccess.get(s);
            if (info == null) return;
            int flags = keyFilterFlag(info.flags, wanted);
            if (flags == info.flags) return;
            info.flags = flags;
            infoAccess.set(s, info);
        } catch (Throwable ignored) { }
    }

    @Override public boolean onKeyEvent(Object keyEvent) {
        for (KeyFilter f : keyFilters) {
            try {
                if (f.onKeyEvent((KeyEvent) keyEvent)) return true;
            } catch (Throwable ignored) { }
        }
        return false;
    }

    @Override public void onAccessibilityEvent(Object event) {
        for (EventListener l : listeners) {
            try { l.onAccessibilityEvent((AccessibilityEvent) event); } catch (Throwable ignored) { }
        }
    }
}
