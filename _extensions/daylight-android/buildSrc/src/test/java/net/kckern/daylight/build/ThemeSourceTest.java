package net.kckern.daylight.build;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.Test;

public class ThemeSourceTest {

    private static Map<String, Object> map(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    @Test public void noBlockIsEmptyAndRendersEmptyFiles() {
        Map<String, Object> theme = ThemeSource.parse(null, "x.yml");
        assertTrue(theme.isEmpty());
        Map<String, String> files = ThemeSource.render(theme);
        assertEquals(2, files.size());
        assertFalse(files.get("values/daylight_theme_device.xml").contains("<color"));
        assertFalse(files.get("values/daylight_theme_device.xml").contains("<string"));
    }

    @Test public void lightAndDarkGoToTheirOwnSets() {
        Map<String, Object> theme = ThemeSource.parse(map(
                "mode", "dark", "font", "sans-serif",
                "light", map("primary", "#aa0000"),
                "dark", map("primary", "#FF5555", "background", "#FF000000")), "x.yml");
        Map<String, String> files = ThemeSource.render(theme);
        String day = files.get("values/daylight_theme_device.xml");
        String night = files.get("values-night/daylight_theme_device.xml");
        assertTrue(day.contains("<color name=\"daylight_primary\">#AA0000</color>"));
        assertTrue(day.contains("<string name=\"daylight_theme_mode\" translatable=\"false\">dark</string>"));
        assertTrue(day.contains("<string name=\"daylight_font_family\" translatable=\"false\">sans-serif</string>"));
        assertFalse(day.contains("FF5555"));
        assertTrue(night.contains("<color name=\"daylight_primary\">#FF5555</color>"));
        assertTrue(night.contains("<color name=\"daylight_background\">#FF000000</color>"));
        assertFalse(night.contains("daylight_theme_mode"));
    }

    @Test public void refusesWhatTheBuildCannotUse() {
        refuse(map("colour", map()), "not a theme setting");
        refuse(map("mode", "auto"), "theme.mode");
        refuse(map("font", "Comic Sans"), "theme.font");
        refuse(map("light", map("brand", "#000000")), "not a seed color");
        refuse(map("dark", map("primary", "red")), "#RRGGBB");
        refuse(map("dark", map("primary", 0x125b47)), "#RRGGBB");
        refuse(map("light", "#000000"), "mapping");
    }

    private static void refuse(Map<String, Object> raw, String message) {
        try {
            ThemeSource.parse(raw, "x.yml");
            fail("accepted " + raw);
        } catch (CatalogException e) {
            assertTrue(e.getMessage(), e.getMessage().contains(message));
        }
    }

    /** The token list here and the colors shell-kit defines, light and dark, are one list. */
    @Test public void tokensMatchShellKitDefaults() throws Exception {
        File res = new File(projectDir(), "shell-kit/src/main/res");
        for (String set : new String[] { "values", "values-night" }) {
            String xml = new String(Files.readAllBytes(new File(res, set + "/daylight_theme_colors.xml").toPath()),
                    StandardCharsets.UTF_8);
            Set<String> names = new LinkedHashSet<>();
            Matcher m = Pattern.compile("<color name=\"daylight_([a-z_]+)\"").matcher(xml);
            while (m.find()) names.add(m.group(1));
            assertEquals(set, ThemeSource.COLORS, names);
        }
    }

    @Test public void phoneFileParses() {
        assertEquals(Collections.singletonMap("mode", "system"),
                DeviceCatalog.load(projectDir()).device("phone").theme);
    }

    private static File projectDir() {
        // Tests run in buildSrc/; the project root is the first directory up holding shell-kit.
        File dir = new File("").getAbsoluteFile();
        while (dir != null && !new File(dir, "shell-kit").isDirectory()) dir = dir.getParentFile();
        if (dir == null) throw new IllegalStateException("no project root above " + new File("").getAbsolutePath());
        return dir;
    }
}
