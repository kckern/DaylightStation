package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.*;

import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Every Now playing icon built untinted (icon(R.drawable.daylight_np_*, "…", 0, …)) is
 * tinted somewhere: the vectors are drawn in black (#FF000000), so an icon no path tints
 * shows black on a dark page. The ⋮ More icon was one (2026-11-26). A source check: cheap,
 * and it fails the day a new icon is added without its tint.
 */
public class IconTintTest {
    private static String source(String name) throws Exception {
        Path p = Paths.get("src/main/java/net/kckern/daylight/cap/mediaservice/shell", name);
        return new String(Files.readAllBytes(p), StandardCharsets.UTF_8);
    }

    @Test public void everyUntintedNowPlayingIconIsTinted() throws Exception {
        String s = source("NowPlayingActivity.java");
        Matcher built = Pattern.compile("(\\w+) = icon\\(R\\.drawable\\.(daylight_np_\\w+), [^,]+, 0,").matcher(s);
        List<String> untinted = new ArrayList<>();
        while (built.find()) untinted.add(built.group(1));
        assertTrue("found the icons", untinted.size() >= 10);

        Set<String> tinted = new HashSet<>();
        Matcher direct = Pattern.compile("(\\w+)\\.setImageTintList\\(").matcher(s);
        while (direct.find()) tinted.add(direct.group(1));
        Matcher toggled = Pattern.compile("toggle\\((\\w+),").matcher(s);
        while (toggled.find()) tinted.add(toggled.group(1));
        // A loop over an array that tints each of its buttons.
        Matcher loop = Pattern.compile("new ImageButton\\[\\] \\{([^}]*)\\}\\) \\{\\s*b\\.setImageTintList").matcher(s);
        while (loop.find()) for (String v : loop.group(1).split(",")) tinted.add(v.trim());

        List<String> missing = new ArrayList<>();
        for (String v : untinted) {
            // An edge button is built as "b" and kept as leftEdge / rightEdge.
            if (v.equals("b")) continue;
            if (!tinted.contains(v)) missing.add(v);
        }
        assertTrue("icons with no tint on any path: " + missing, missing.isEmpty());
        assertTrue("the edge buttons are tinted", tinted.contains("leftEdge") && tinted.contains("rightEdge"));
    }
}
