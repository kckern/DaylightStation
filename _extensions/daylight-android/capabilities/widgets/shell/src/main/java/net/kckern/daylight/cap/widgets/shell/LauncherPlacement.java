package net.kckern.daylight.cap.widgets.shell;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/** Immutable selection and outcome for one launcher handoff. Widget IDs are supplied by Android. */
final class LauncherPlacement {
    static final long TIMEOUT_MS = 10_000;
    /** A banner older than this (a day) is no longer shown. */
    static final long STALE_MS = 24L * 60 * 60 * 1000;
    private static final int RECENT_LIMIT = 5;

    enum Status { CONFIRM, UNCONFIRMED, REFUSED, ADDED, EXTRA_WIDGET }

    final String requestId;
    final String lineageId;
    final String contentId;
    final String title;
    final boolean playlist;
    final long startedAt;
    final long updatedAt;
    final boolean refused;
    final boolean shortcutConfirmed;
    final int manualWidget;
    final int callbackWidget;

    LauncherPlacement(String requestId, String lineageId, String contentId, String title, boolean playlist,
                      long startedAt, long updatedAt, boolean refused, boolean shortcutConfirmed,
                      int manualWidget, int callbackWidget) {
        this.requestId = requestId;
        this.lineageId = lineageId;
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
        return new LauncherPlacement(requestId, requestId, contentId, title, playlist, now, now, false, false, 0, 0);
    }

    LauncherPlacement retry(String newRequestId, long now) {
        return new LauncherPlacement(newRequestId, lineageId, contentId, title, playlist, now, now,
                false, false, 0, 0);
    }

    LauncherPlacement updatedAt(long now) {
        return new LauncherPlacement(requestId, lineageId, contentId, title, playlist, startedAt, now,
                refused, shortcutConfirmed, manualWidget, callbackWidget);
    }

    static List<LauncherPlacement> visible(List<LauncherPlacement> requests, long now) {
        List<LauncherPlacement> sorted = new ArrayList<>(requests);
        sorted.sort(Comparator.comparingLong((LauncherPlacement request) -> request.updatedAt)
                .thenComparingLong(request -> request.startedAt).thenComparing(request -> request.requestId).reversed());
        List<LauncherPlacement> visible = new ArrayList<>();
        for (int index = 0; index < sorted.size(); index++) {
            LauncherPlacement request = sorted.get(index);
            // A problem that is a day old is not news: it stops showing on its own.
            if (request.status(now) != Status.CONFIRM && now - Math.max(request.updatedAt, request.startedAt) > STALE_MS) continue;
            if (index < RECENT_LIMIT || request.status(now) == Status.CONFIRM || request.hasExtraWidget(requests)) {
                visible.add(request);
            }
        }
        return visible;
    }

    boolean hasExtraWidget(List<LauncherPlacement> requests) {
        if (manualWidget > 0 && callbackWidget > 0 && manualWidget != callbackWidget) return true;
        int widget = manualWidget > 0 ? manualWidget : callbackWidget;
        if (widget <= 0) return false;
        return requests.stream().anyMatch(other -> lineageId.equals(other.lineageId)
                && !requestId.equals(other.requestId)
                && ((other.manualWidget > 0 && other.manualWidget != widget)
                    || (other.callbackWidget > 0 && other.callbackWidget != widget)));
    }

    Status status(long now) {
        if (manualWidget > 0 && callbackWidget > 0 && manualWidget != callbackWidget) return Status.EXTRA_WIDGET;
        if (shortcutConfirmed || manualWidget > 0 || callbackWidget > 0) return Status.ADDED;
        if (refused) return Status.REFUSED;
        return now - startedAt >= TIMEOUT_MS ? Status.UNCONFIRMED : Status.CONFIRM;
    }

    LauncherPlacement refuse() {
        return new LauncherPlacement(requestId, lineageId, contentId, title, playlist, startedAt, updatedAt, true,
                shortcutConfirmed, manualWidget, callbackWidget);
    }

    LauncherPlacement confirmShortcut() {
        if (playlist || refused || shortcutConfirmed) return null;
        return new LauncherPlacement(requestId, lineageId, contentId, title, false, startedAt, updatedAt, false, true, 0, 0);
    }

    LauncherPlacement bindManual(int widgetId, boolean occupied) {
        if (!playlist || widgetId <= 0 || occupied || manualWidget > 0) return null;
        return new LauncherPlacement(requestId, lineageId, contentId, title, true, startedAt, updatedAt, refused, false,
                widgetId, callbackWidget);
    }

    LauncherPlacement bindCallback(int widgetId, boolean ours, boolean occupied) {
        if (!playlist || refused || !ours || widgetId <= 0 || callbackWidget > 0) return null;
        if (manualWidget == widgetId && !occupied) return null;
        if (occupied && manualWidget != widgetId) return null;
        return new LauncherPlacement(requestId, lineageId, contentId, title, true, startedAt, updatedAt, false, false,
                manualWidget, widgetId);
    }
}
