package net.kckern.daylight.core;

/** The device cannot perform this command. The message is the reason shown to the caller. */
public final class UnsupportedException extends RuntimeException {
    public UnsupportedException(String reason) { super(reason); }
}
