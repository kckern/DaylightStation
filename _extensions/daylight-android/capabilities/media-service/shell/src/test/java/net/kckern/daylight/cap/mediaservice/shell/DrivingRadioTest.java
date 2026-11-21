package net.kckern.daylight.cap.mediaservice.shell;

import net.kckern.daylight.shellkit.DrivingRadioSettings;
import org.junit.Test;

import java.util.Arrays;
import java.util.Collections;

import static org.junit.Assert.assertEquals;

public class DrivingRadioTest {
    @Test public void dayRulePrecedesDefaultWithoutRepeatingIt() {
        assertEquals(Arrays.asList("program:sunday", "program:music"),
                DrivingRadioSettings.priority("program:sunday", "program:music"));
        assertEquals(Collections.singletonList("program:music"),
                DrivingRadioSettings.priority("program:music", "program:music"));
    }

    @Test public void stationNamesMayBeSpacedOrPunctuatedInVoiceSearch() {
        assertEquals(DrivingRadio.spokenName("FM100"), DrivingRadio.spokenName("F.M. 100"));
    }

    @Test public void emptyRulesOnlyUseAnExplicitDefault() {
        assertEquals(Collections.singletonList("program:music"),
                DrivingRadioSettings.priority("", "program:music"));
        assertEquals(Collections.emptyList(), DrivingRadioSettings.priority("", ""));
    }
}
