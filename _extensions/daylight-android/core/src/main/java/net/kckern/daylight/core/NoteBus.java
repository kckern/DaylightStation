package net.kckern.daylight.core;

import net.kckern.daylight.core.spi.NoteListener;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Live notes from an instrument. Delivered on the publisher's thread, in
 * subscription order, with no queue: this is the path from a key press to sound.
 */
public final class NoteBus {
    private final List<NoteListener> listeners = new CopyOnWriteArrayList<>();

    public void subscribe(NoteListener l) { listeners.add(l); }
    public void unsubscribe(NoteListener l) { listeners.remove(l); }

    public void noteOn(int note, int velocity, long epochMs) {
        for (NoteListener l : listeners) { try { l.noteOn(note, velocity, epochMs); } catch (Throwable ignored) { } }
    }

    public void noteOff(int note, long epochMs) {
        for (NoteListener l : listeners) { try { l.noteOff(note, epochMs); } catch (Throwable ignored) { } }
    }

    public void controlChange(int controller, int value) {
        for (NoteListener l : listeners) { try { l.controlChange(controller, value); } catch (Throwable ignored) { } }
    }
}
