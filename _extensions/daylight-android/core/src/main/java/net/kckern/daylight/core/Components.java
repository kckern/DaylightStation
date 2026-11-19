package net.kckern.daylight.core;

import net.kckern.daylight.api.ShellServices;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

/** Shell-owned objects by name, with a callback for binds and unbinds that happen later. */
public final class Components {
    public interface Listener { void onComponent(Object instanceOrNull); }

    private final ShellServices shell;
    private final Map<String, List<Listener>> listeners = new ConcurrentHashMap<>();

    Components(ShellServices shell) { this.shell = shell; }

    public Object get(String name) { return shell.component(name); }

    /**
     * Calls the listener now if the component is already bound (a payload hot swap
     * happens while the shell's components stay bound), and again on every change.
     */
    public void watch(String name, Listener listener) {
        listeners.computeIfAbsent(name, k -> new CopyOnWriteArrayList<>()).add(listener);
        Object now = get(name);
        if (now != null) listener.onComponent(now);
    }

    void dispatch(String name, Object instance) {
        List<Listener> list = listeners.get(name);
        if (list == null) return;
        for (Listener l : list) {
            try { l.onComponent(instance); } catch (Throwable ignored) { }
        }
    }
}
