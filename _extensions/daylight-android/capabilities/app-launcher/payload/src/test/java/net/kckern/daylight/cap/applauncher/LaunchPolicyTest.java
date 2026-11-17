package net.kckern.daylight.cap.applauncher;

import static org.junit.Assert.*;

import net.kckern.daylight.core.kiosk.AllowRules;

import org.junit.Test;

public class LaunchPolicyTest {
    private static final AllowRules ALLOWED = AllowRules.parse("com.example.game,com.example.tools/.Pairing");

    @Test public void whatResolvesToNothingIsNotInstalled() {
        assertEquals("not_installed", LaunchPolicy.refusal(null, null, ALLOWED, false));
        assertEquals("not_installed", LaunchPolicy.refusal("com.example.game", null, ALLOWED, false));
    }

    @Test public void theResolvedActivityIsWhatIsChecked() {
        assertNull(LaunchPolicy.refusal("com.example.game", "com.example.game.Main", ALLOWED, false));
        assertNull(LaunchPolicy.refusal("com.example.tools", "com.example.tools.Pairing", ALLOWED, false));
        assertEquals("one activity is allowed, not its package", "not_allowed",
                LaunchPolicy.refusal("com.example.tools", "com.example.tools.Settings", ALLOWED, false));
        assertEquals("not_allowed", LaunchPolicy.refusal("com.example.other", "com.example.other.Main", ALLOWED, false));
    }

    @Test public void aChooserIsNeverAllowed() {
        // An intent several apps could take resolves to the system's chooser. Nothing may be started through it.
        assertEquals("not_allowed", LaunchPolicy.refusal("android", "com.android.internal.app.ResolverActivity", ALLOWED, false));
        assertEquals("not_allowed", LaunchPolicy.refusal("android", "com.android.internal.app.ResolverActivity",
                AllowRules.parse("android.auto"), false));
    }

    @Test public void anEmptyOrBrokenListAllowsNothing() {
        assertEquals("not_allowed", LaunchPolicy.refusal("com.example.game", "com.example.game.Main", AllowRules.parse(""), false));
        assertEquals("not_allowed", LaunchPolicy.refusal("com.example.game", "com.example.game.Main", AllowRules.parseOrEmpty("*"), false));
    }

    @Test public void aPackageTheGateHasClosedIsNotAllowedEvenWhenListed() {
        assertEquals("not_allowed", LaunchPolicy.refusal("com.example.game", "com.example.game.Main", ALLOWED, true));
    }

    @Test public void anActivityLevelRuleExemptsThatActivityAndAPackageRuleThePackage() {
        AllowRules activityOnly = AllowRules.parse("com.example.game/.Play");
        assertEquals("only the activity the rule names", "com.example.game.Play",
                LaunchPolicy.exemptActivity("com.example.game", "com.example.game.Play", activityOnly));
        assertNull("a package rule exempts the package",
                LaunchPolicy.exemptActivity("com.example.game", "com.example.game.Play", AllowRules.parse("com.example.game")));
        assertNull(LaunchPolicy.exemptActivity("com.example.game", "com.example.game.Play", AllowRules.parse("com.example.*")));
        assertNull("a package rule beside an activity rule still covers the package",
                LaunchPolicy.exemptActivity("com.example.game", "com.example.game.Play", AllowRules.parse("com.example.game/.Play,com.example.game")));
    }
}
