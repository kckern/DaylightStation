package net.kckern.daylight.cap.widgets.shell;

/** Immutable selection and outcome for one launcher handoff. Widget IDs are supplied by Android. */
final class LauncherPlacement {
    static final long TIMEOUT_MS = 10_000;

    enum Status { CONFIRM, UNCONFIRMED, REFUSED, ADDED, EXTRA_WIDGET }

    final String requestId;
    final String contentId;
    final String title;
    final boolean playlist;
    final long startedAt;
    final long updatedAt;
    final boolean refused;
    final boolean shortcutConfirmed;
    final int manualWidget;
    final int callbackWidget;

    LauncherPlacement(String requestId, String contentId, String title, boolean playlist,
                      long startedAt, long updatedAt, boolean refused, boolean shortcutConfirmed,
                      int manualWidget, int callbackWidget) {
        this.requestId = requestId;
        this.contentId = contentId;
        this.title = title;
        this.playlist = playlist;
        this.startedAt = startedAt;
        this.updatedAt = updatedAt;
        this.refused = refused;
        this.shortcutConfirmed = shortcutConfirmed;
        this.manualWidget = manualWidget;
        this.callbackWidget = callbackWidget;
    }

    static LauncherPlacement pending(String requestId, String contentId, String title,
                                     boolean playlist, long now) {
        return new LauncherPlacement(requestId, contentId, title, playlist, now, now, false, false, 0, 0);
    }

    Status status(long now) {
        if (manualWidget > 0 && callbackWidget > 0 && manualWidget != callbackWidget) return Status.EXTRA_WIDGET;
        if (shortcutConfirmed || manualWidget > 0 || callbackWidget > 0) return Status.ADDED;
        if (refused) return Status.REFUSED;
        return now - startedAt >= TIMEOUT_MS ? Status.UNCONFIRMED : Status.CONFIRM;
    }

    LauncherPlacement refuse() {
        return new LauncherPlacement(requestId, contentId, title, playlist, startedAt, updatedAt, true,
                shortcutConfirmed, manualWidget, callbackWidget);
    }

    LauncherPlacement confirmShortcut() {
        if (playlist || refused || shortcutConfirmed) return null;
        return new LauncherPlacement(requestId, contentId, title, false, startedAt, updatedAt, false, true, 0, 0);
    }

    LauncherPlacement bindManual(int widgetId, boolean occupied) {
        if (!playlist || widgetId <= 0 || occupied || manualWidget > 0) return null;
        return new LauncherPlacement(requestId, contentId, title, true, startedAt, updatedAt, refused, false,
                widgetId, callbackWidget);
    }

    LauncherPlacement bindCallback(int widgetId, boolean ours, boolean occupied) {
        if (!playlist || refused || !ours || widgetId <= 0 || callbackWidget > 0) return null;
        if (manualWidget == widgetId && !occupied) return null;
        if (occupied && manualWidget != widgetId) return null;
        return new LauncherPlacement(requestId, contentId, title, true, startedAt, updatedAt, false, false,
                manualWidget, widgetId);
    }
}
