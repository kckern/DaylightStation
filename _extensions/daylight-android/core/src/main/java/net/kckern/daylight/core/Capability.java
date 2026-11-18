package net.kckern.daylight.core;

/**
 * One independent feature. A capability talks to the core only; it never calls
 * another capability directly. It needs a public no-argument constructor.
 */
public interface Capability {
    String name();

    /** Declare settings and routes. No side effects on the device here. */
    void register(CoreContext core);

    /** Begin work. Throw only when this capability cannot run at all on this device. */
    void start() throws Exception;

    /** Must not throw. */
    void stop();
}
