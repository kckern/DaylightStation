package net.kckern.daylight.core;

import org.json.JSONObject;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Fire-and-forget notifications between capabilities, by topic. The note bus carries
 * live instrument notes and nothing else; this carries everything that is not a note.
 * Topics used by the kiosk: "screen" {on}, "network" {connected}, "key" {code, action},
 * "kiosk-focus" {focused}, "foreground" {event, ...}.
 * Listeners run on the publisher's thread and must return quickly.
 */
public final class EventBus {
    public interface Listener { void onEvent(String topic, JSONObject detail); }

    private final List<Listener> listeners = new CopyOnWriteArrayList<>();

    public void subscribe(Listener l) { listeners.add(l); }

    public void unsubscribe(Listener l) { listeners.remove(l); }

    /** How many listeners are subscribed. */
    public int subscribers() { return listeners.size(); }

    public void publish(String topic, JSONObject detail) {
        for (Listener l : listeners) {
            try { l.onEvent(topic, detail); } catch (Throwable ignored) { }
        }
    }
}
