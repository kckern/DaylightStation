package net.kckern.daylight.api;

/**
 * Implemented by a payload, called by the shell.
 *
 * The entry class name is fixed: net.kckern.daylight.payload.Main.
 * If start() throws, the shell treats the payload as broken and rolls back.
 */
public interface Payload {
    /**
     * Runs on a thread of the shell's loader, never the main thread, and must return
     * within the shell's start deadline (20 seconds). A start() that throws or runs
     * past the deadline makes the shell give up on this payload and roll back.
     */
    void start(ShellServices shell);

    /**
     * Tear down. Called before a swap or shell shutdown. Must not throw, and must be
     * safe to call more than once: after a missed start deadline the shell calls it
     * while start() may still be running, and again when start() returns.
     */
    void stop();

    /** For example "p1-foundation". */
    String version();

    /**
     * A shell-owned Android component was bound or unbound. The shell declares such
     * components in its manifest; the payload decides what to do with them.
     * instance is null when the component went away.
     */
    void onShellComponent(String name, Object instance);
}
