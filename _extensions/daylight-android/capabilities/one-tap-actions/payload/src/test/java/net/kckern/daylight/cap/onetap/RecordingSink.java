package net.kckern.daylight.cap.onetap;

import net.kckern.daylight.cap.onetap.ActionCatalog.Action;
import net.kckern.daylight.core.UnsupportedException;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** The launcher and the surface cache, as far as the capability uses them. */
final class RecordingSink implements SurfaceSink {
    final List<String> published = new ArrayList<>();
    final List<String> publishedUris = new ArrayList<>();
    Map<String, String> cache;
    String pinned;
    boolean pinSupported = true;
    int publishes;
    RuntimeException failure;

    @Override public int maxShortcuts() { return 4; }

    @Override public void publish(List<Action> shortcuts, SurfacePlan.Linker linker, Map<String, String> tileCache) {
        if (failure != null) throw failure;
        publishes++;
        published.clear();
        publishedUris.clear();
        for (Action a : shortcuts) { published.add(a.id); publishedUris.add(linker.uri(a)); }
        cache = tileCache;
    }

    final List<String> refreshed = new ArrayList<>();
    final List<String> disabled = new ArrayList<>();
    /** The shortcut ids the launcher holds as pinned. */
    List<String> pinnedIds = new ArrayList<>();

    @Override public List<String> pinnedIds() { return pinnedIds; }

    @Override public void refreshPinned(SurfacePlan.Pins pins, SurfacePlan.Linker linker) {
        refreshed.clear();
        disabled.clear();
        for (Map.Entry<String, Action> e : pins.update.entrySet()) refreshed.add(e.getKey() + " " + linker.uri(e.getValue()));
        disabled.addAll(pins.disable);
    }

    boolean refuse;

    @Override public boolean canPin() { return pinSupported; }

    /** The confirmation token of the last request; null for a pin of a configured action. */
    String token;

    @Override public void pin(Action action, String uri, String confirmToken) {
        token = confirmToken;
        if (!pinSupported) throw new UnsupportedException("this launcher does not pin shortcuts");
        if (refuse) throw new UnsupportedException("the launcher refused the pin request");
        pinned = action.id + " " + uri;
        pinnedIds.add(SurfacePlan.pinId(action));
    }
}
