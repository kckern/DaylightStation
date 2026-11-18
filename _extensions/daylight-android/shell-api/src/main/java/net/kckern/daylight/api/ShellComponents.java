package net.kckern.daylight.api;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Shell-owned objects a payload may ask for by name (an accessibility service, a
 * native engine). A manifest-declared component publishes itself when Android
 * binds it and publishes null when it goes away. Lives in shell-api so that a
 * capability's shell half, which cannot see the shell application module, can call it.
 */
public final class ShellComponents {
    public interface Listener { void onShellComponent(String name, Object instance); }

    private static final Map<String, Object> COMPONENTS = new ConcurrentHashMap<>();
    private static volatile Listener listener;

    private ShellComponents() { }

    public static void publish(String name, Object instance) {
        if (instance == null) COMPONENTS.remove(name); else COMPONENTS.put(name, instance);
        Listener l = listener;
        if (l != null) l.onShellComponent(name, instance);
    }

    public static Object get(String name) { return COMPONENTS.get(name); }

    /** The shell service forwards to the active payload. Pass null to stop forwarding. */
    public static void setListener(Listener l) { listener = l; }
}
