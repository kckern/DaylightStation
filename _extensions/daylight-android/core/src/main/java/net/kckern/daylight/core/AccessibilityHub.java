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
    private volatile int extraEventTypes;
    private volatile Object bound;

    /** Called with the component when it binds, and with null when it unbinds or the payload stops. */
    public synchronized void bind(Object service) {
        Object previous = bound;
        if (previous instanceof AccessibilityHost && previous != service) ((AccessibilityHost) previous).setDelegate(null);
        bound = service;
        if (service instanceof AccessibilityHost) ((AccessibilityHost) service).setDelegate(this);
        applyServiceInfo();
    }

    public boolean isBound() { return bound != null; }

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
            AccessibilityServiceInfo info = s.getServiceInfo();
            if (info == null) return;
            if (!keyFilters.isEmpty()) info.flags |= AccessibilityServiceInfo.FLAG_REQUEST_FILTER_KEY_EVENTS;
            info.eventTypes |= extraEventTypes;
            s.setServiceInfo(info);
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
