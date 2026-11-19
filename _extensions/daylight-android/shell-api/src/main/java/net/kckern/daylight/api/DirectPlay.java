package net.kckern.daylight.api;

/**
 * Whether a tap on a media action starts native playback with no window, and how.
 * Pure: the widgets and the tiles (installed code in other capabilities' shell halves)
 * ask here, and the play service reads its one intent extra through here.
 *
 * The direct path is a foreground-service start of a NON-exported service of the
 * media-service shell half (PlayActionService). Its intent carries one thing, an action
 * id. The service hands that id to the payload, which answers with the content of the
 * configured or pinned action of that id, or with nothing. A caller cannot name content:
 * no other app can reach the service, and the only thing it reads is an action id.
 *
 * Which surface may start a foreground service from the background (Android 12, API
 * 31, and later, for an app that targets 31 or higher):
 *
 *  - A widget tap: a documented exemption ("the user performs an action on a UI element
 *    related to your app ... notification, widget"), so the widget's PendingIntent is
 *    PendingIntent.getForegroundService on every version.
 *  - A quick-settings tile: not named among the exemptions. Below API 31 there is no
 *    such restriction; from 31 the tile tries the service and, when Android refuses the
 *    start, launches the keyed link exactly as before.
 *  - A launcher shortcut: a shortcut's intent starts an activity, never a service, so it
 *    keeps the keyed link and the invisible play screen.
 */
public final class DirectPlay {
    /** The installed play service, by name: the widgets and tiles cannot reference the media-service shell half. */
    public static final String SERVICE = "net.kckern.daylight.cap.mediaservice.shell.PlayActionService";
    /** The intent extra that carries the action id, and nothing else is read from the intent. */
    public static final String EXTRA_ACTION = "action";
    /** The first API level on which a foreground-service start from the background can be refused. */
    public static final int BACKGROUND_START_LIMIT_SDK = 31;

    public enum Surface { WIDGET, TILE, SHORTCUT }

    public enum Path {
        /** Start the play service; no window. */
        SERVICE,
        /** Try the play service; when Android refuses the start, launch the keyed link. */
        SERVICE_ELSE_LINK,
        /** Launch the keyed link (the link activity, then the invisible play screen). */
        LINK
    }

    private DirectPlay() { }

    /**
     * @param direct           the action id the surface cache holds as playable directly, or empty
     * @param serviceInstalled whether this build has the play service (a build without media-service has none)
     */
    public static Path path(Surface surface, int sdkInt, String direct, boolean serviceInstalled) {
        if (surface == null || !serviceInstalled || actionFrom(direct) == null) return Path.LINK;
        switch (surface) {
            case WIDGET: return Path.SERVICE;
            case TILE: return sdkInt >= BACKGROUND_START_LIMIT_SDK ? Path.SERVICE_ELSE_LINK : Path.SERVICE;
            default: return Path.LINK;
        }
    }

    /** The action id an intent extra holds, or null when it is anything but an action id. */
    public static String actionFrom(String extra) {
        return SurfaceKeys.actionId(extra) ? extra : null;
    }
}
