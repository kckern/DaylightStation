package net.kckern.daylight.cap.widgets.shell;

import net.kckern.daylight.api.SurfaceKeys;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * What a one-action button widget shows, and what its chooser lists, from what the
 * surface cache holds. Pure.
 *
 * A widget remembers an action id and nothing else. The label, the icon and the link
 * are read from the cache each time the widget is drawn, so a link is always the one
 * the payload last wrote, under the key in force. An action that no longer exists has
 * no link in the cache: the button then reads "Not set" and a tap opens the chooser.
 */
final class ButtonFace {
    static final String APP_NAME = "Playlist";   // a widget with no playlist name yet (never the brand)
    static final String UNSET_LABEL = "Not set";
    /** A drawable of this module, shown by a button with no action. */
    static final String UNSET_ICON = "ic_widget_button_unset";
    private static final String DEFAULT_ICON = "ic_action_open";
    /** The most entries the chooser shows: twelve configured actions and twenty-four pinned ones fit. */
    static final int MAX_CHOICES = 40;

    /** False for a button with no action, or whose action is gone: a tap opens the chooser. */
    final boolean set;
    final String label;
    /** A drawable name: ic_action_<icon> (one-tap-actions' shell half), or this module's own. */
    final String iconName;
    /** A daylight:// link, or empty when not set. */
    final String link;

    private ButtonFace(boolean set, String label, String iconName, String link) {
        this.set = set;
        this.label = label;
        this.iconName = iconName;
        this.link = link;
    }

    /**
     * @param actionId the id the widget was given in its chooser, or empty
     * @param link     the action's cached link, already checked to be the app's own scheme, or empty
     */
    static ButtonFace of(String actionId, String label, String icon, String link) {
        if (!SurfaceKeys.actionId(actionId) || link == null || link.isEmpty()) {
            return new ButtonFace(false, UNSET_LABEL, UNSET_ICON, "");
        }
        boolean plain = icon != null && icon.matches("[a-z0-9_]{1,24}");
        return new ButtonFace(true, label == null || label.isEmpty() ? APP_NAME : label,
                plain ? "ic_action_" + icon : DEFAULT_ICON, link);
    }

    /** One line of the chooser. */
    static final class Choice {
        final String id;
        final String label;

        Choice(String id, String label) {
            this.id = id;
            this.label = label;
        }

        /** What a list adapter shows. */
        @Override public String toString() { return label; }
    }

    /** Reads one value of the surface cache; null or empty when absent. */
    interface Cache { String get(String key); }

    /**
     * The actions a button can be given: the cached ids in order, each once, and only
     * those whose cached link is the app's own. Empty before a payload has ever run.
     */
    static List<Choice> choices(String idsCsv, Cache cache) {
        List<Choice> out = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (String raw : (idsCsv == null ? "" : idsCsv).split(",")) {
            if (out.size() >= MAX_CHOICES) break;
            String id = raw.trim();
            if (!SurfaceKeys.actionId(id) || !seen.add(id)) continue;
            if (!SurfaceKeys.launchable(cache.get(SurfaceKeys.action(id, SurfaceKeys.URI)))) continue;
            String label = cache.get(SurfaceKeys.action(id, SurfaceKeys.LABEL));
            out.add(new Choice(id, label == null || label.isEmpty() ? id : label));
        }
        return out;
    }

    /**
     * Whether a widget id is one of this provider's. The chooser is exported (the
     * launcher starts it), so the id in its intent can be anybody's number: it is used
     * only when Android itself says the widget with that id belongs to this app's
     * button provider.
     *
     * @param providerPackage the package of the widget's provider as Android reports it; null when it knows no such widget
     */
    static int coverSide(int width, int height) {
        if (width <= 0 || height <= 0) return 50;
        // The badge adds 18 dp below the square after a 6 dp overlap.
        return Math.max(1, Math.min(width - 2, height - 18));
    }

    static boolean ours(int widgetId, String providerPackage, String providerClass, String myPackage, String myProviderClass) {
        return widgetId != 0 && providerPackage != null && providerPackage.equals(myPackage)
                && providerClass != null && providerClass.equals(myProviderClass);
    }

    /** Where a widget's choice is kept, in this module's own private preferences file. */
    static String storeKey(int widgetId) { return "button." + widgetId + ".action"; }
}
