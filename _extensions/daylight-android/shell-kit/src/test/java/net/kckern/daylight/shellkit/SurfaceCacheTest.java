package net.kckern.daylight.shellkit;

import static org.junit.Assert.*;

import android.content.ContextWrapper;
import android.content.SharedPreferences;

import net.kckern.daylight.api.SurfaceKeys;

import org.junit.Test;

import java.util.HashMap;
import java.util.Map;
import java.util.Set;

public class SurfaceCacheTest {
    /** Only getString is read. */
    private static final class Prefs implements SharedPreferences {
        final Map<String, String> values = new HashMap<>();
        @Override public String getString(String key, String def) { return values.containsKey(key) ? values.get(key) : def; }
        @Override public Map<String, ?> getAll() { return values; }
        @Override public Set<String> getStringSet(String key, Set<String> def) { return def; }
        @Override public int getInt(String key, int def) { return def; }
        @Override public long getLong(String key, long def) { return def; }
        @Override public float getFloat(String key, float def) { return def; }
        @Override public boolean getBoolean(String key, boolean def) { return def; }
        @Override public boolean contains(String key) { return values.containsKey(key); }
        @Override public Editor edit() { throw new UnsupportedOperationException("installed components only read"); }
        @Override public void registerOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener l) { }
        @Override public void unregisterOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener l) { }
    }

    private static final class Ctx extends ContextWrapper {
        final Prefs prefs = new Prefs();
        String asked;
        boolean none;
        Ctx() { super(null); }
        @Override public SharedPreferences getSharedPreferences(String name, int mode) {
            asked = name;
            return none ? null : prefs;
        }
    }

    @Test public void readsTheFileThePayloadWrites() {
        Ctx ctx = new Ctx();
        ctx.prefs.values.put("tile.1.label", "New memo");
        assertEquals("New memo", SurfaceCache.get(ctx, SurfaceKeys.tile(1, SurfaceKeys.LABEL)));
        assertEquals(SurfaceKeys.PREFS, ctx.asked);
    }

    @Test public void anAbsentKeyOrAnAbsentFileIsEmpty() {
        Ctx ctx = new Ctx();
        assertEquals("", SurfaceCache.get(ctx, "tile.2.label"));
        ctx.none = true;
        assertEquals("", SurfaceCache.get(ctx, "tile.1.label"));
    }

    @Test public void aLinkIsReturnedOnlyWhenItIsTheAppsOwnScheme() {
        Ctx ctx = new Ctx();
        ctx.prefs.values.put("tile.1.uri", "daylight://action/memo?k=abc");
        ctx.prefs.values.put("tile.2.uri", "https://evil.example/");
        ctx.prefs.values.put("widget.1.uri", "intent://x#Intent;end");
        assertEquals("daylight://action/memo?k=abc", SurfaceCache.link(ctx, SurfaceKeys.tile(1, SurfaceKeys.URI)));
        assertEquals("", SurfaceCache.link(ctx, SurfaceKeys.tile(2, SurfaceKeys.URI)));
        assertEquals("", SurfaceCache.link(ctx, SurfaceKeys.widget(1, SurfaceKeys.URI)));
        assertEquals("", SurfaceCache.link(ctx, SurfaceKeys.tile(3, SurfaceKeys.URI)));
    }
}
