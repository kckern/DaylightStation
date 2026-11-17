package net.kckern.daylight.api;

/**
 * Implemented by a payload, called by the shell.
 *
 * The entry class name is fixed: net.kckern.daylight.payload.Main.
 * If start() throws, the shell treats the payload as broken and rolls back.
 */
public interface Payload {
    void start(ShellServices shell);

    /** Tear down. Called before a swap or shell shutdown. Must not throw. */
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
