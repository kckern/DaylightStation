package net.kckern.daylight.core.spi;

/** Subscribed on the NoteBus. Every method has an empty default. */
public interface NoteListener {
    default void noteOn(int note, int velocity, long epochMs) { }
    default void noteOff(int note, long epochMs) { }
    default void controlChange(int controller, int value) { }
}
