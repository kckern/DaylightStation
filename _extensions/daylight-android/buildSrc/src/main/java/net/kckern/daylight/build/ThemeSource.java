package net.kckern.daylight.build;

import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * A device file's {@code theme:} block, checked and rendered as Android resources for
 * that device's build. The defaults are shell-kit's {@code res/values} (light) and
 * {@code res/values-night} (dark); what this renders sits in the app's flavor source
 * set, which outranks a library's resources, so each line replaces one default.
 *
 * <pre>
 * theme:
 *   mode: system            # system (follow the phone), light or dark
 *   font: sans-serif-condensed
 *   light: { primary: "#125B47" }
 *   dark:  { primary: "#4FC99A", background: "#000000" }
 * </pre>
 *
 * A {@code light:} line changes the light set only and a {@code dark:} line the dark set
 * only: a color picked for one background is rarely right on the other.
 */
public final class ThemeSource {
    /**
     * The seed colors, as named in shell-kit's daylight_theme_colors.xml without the
     * prefix. Every other color is computed from these (shell-kit ThemeColors), so these
     * are all a device can set.
     */
    public static final Set<String> COLORS = Collections.unmodifiableSet(new LinkedHashSet<>(Arrays.asList(
            "background", "surface", "ink", "primary", "secondary", "danger", "attention")));
    static final Set<String> MODES = Collections.unmodifiableSet(new LinkedHashSet<>(Arrays.asList("system", "light", "dark")));
    private static final Set<String> KEYS = Collections.unmodifiableSet(new LinkedHashSet<>(Arrays.asList("mode", "font", "light", "dark")));
    private static final Pattern COLOR = Pattern.compile("#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})");
    /** A system font family name (sans-serif, sans-serif-condensed, serif, monospace...). */
    private static final Pattern FONT = Pattern.compile("[a-z][a-z0-9-]*");

    private ThemeSource() {}

    /** Checks the raw block and returns it in a fixed shape (mode, font, light, dark); empty for none. */
    static Map<String, Object> parse(Object raw, String where) {
        if (raw == null) return Collections.emptyMap();
        if (!(raw instanceof Map)) throw new CatalogException(where + ": theme must be a mapping");
        Map<?, ?> block = (Map<?, ?>) raw;
        for (Object key : block.keySet()) {
            if (!KEYS.contains(String.valueOf(key))) {
                throw new CatalogException(where + ": theme." + key + " is not a theme setting (one of " + KEYS + ")");
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        Object mode = block.get("mode");
        if (mode != null) {
            if (!MODES.contains(String.valueOf(mode))) {
                throw new CatalogException(where + ": theme.mode must be one of " + MODES);
            }
            out.put("mode", String.valueOf(mode));
        }
        Object font = block.get("font");
        if (font != null) {
            if (!(font instanceof String) || !FONT.matcher((String) font).matches()) {
                throw new CatalogException(where + ": theme.font must be a font family name such as sans-serif-condensed");
            }
            out.put("font", font);
        }
        for (String set : new String[] { "light", "dark" }) {
            Object colors = block.get(set);
            if (colors == null) continue;
            if (!(colors instanceof Map)) throw new CatalogException(where + ": theme." + set + " must be a mapping of color tokens");
            Map<String, String> checked = new LinkedHashMap<>();
            for (Map.Entry<?, ?> e : ((Map<?, ?>) colors).entrySet()) {
                String token = String.valueOf(e.getKey());
                if (!COLORS.contains(token)) {
                    throw new CatalogException(where + ": theme." + set + "." + token + " is not a seed color (one of " + COLORS + ")");
                }
                Object value = e.getValue();
                if (!(value instanceof String) || !COLOR.matcher((String) value).matches()) {
                    throw new CatalogException(where + ": theme." + set + "." + token + " must be a quoted \"#RRGGBB\" or \"#AARRGGBB\"");
                }
                checked.put(token, ((String) value).toUpperCase(java.util.Locale.ROOT));
            }
            out.put(set, Collections.unmodifiableMap(checked));
        }
        return Collections.unmodifiableMap(out);
    }

    /**
     * The resource files for a device's theme block, keyed by their path under the res
     * directory. Always both files, so a theme line taken out of the device file goes
     * away from the build too.
     */
    @SuppressWarnings("unchecked")
    public static Map<String, String> render(Map<String, Object> theme) {
        StringBuilder values = new StringBuilder(head());
        if (theme.containsKey("mode")) {
            values.append("    <string name=\"daylight_theme_mode\" translatable=\"false\">").append(theme.get("mode")).append("</string>\n");
        }
        if (theme.containsKey("font")) {
            values.append("    <string name=\"daylight_font_family\" translatable=\"false\">").append(theme.get("font")).append("</string>\n");
        }
        colors(values, (Map<String, String>) theme.get("light"));
        StringBuilder night = new StringBuilder(head());
        colors(night, (Map<String, String>) theme.get("dark"));
        Map<String, String> files = new LinkedHashMap<>();
        files.put("values/daylight_theme_device.xml", values.append("</resources>\n").toString());
        files.put("values-night/daylight_theme_device.xml", night.append("</resources>\n").toString());
        return files;
    }

    private static void colors(StringBuilder out, Map<String, String> colors) {
        if (colors == null) return;
        for (Map.Entry<String, String> e : colors.entrySet()) {
            out.append("    <color name=\"daylight_").append(e.getKey()).append("\">").append(e.getValue()).append("</color>\n");
        }
    }

    private static String head() {
        return "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n"
                + "<!-- Generated from the device file's theme: block (buildSrc ThemeSource). Do not edit. -->\n"
                + "<resources>\n";
    }
}
