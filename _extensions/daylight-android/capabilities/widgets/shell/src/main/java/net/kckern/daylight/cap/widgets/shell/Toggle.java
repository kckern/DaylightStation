package net.kckern.daylight.cap.widgets.shell;

import android.content.Context;
import android.content.res.ColorStateList;
import android.widget.Switch;

import net.kckern.daylight.shellkit.DaylightTheme;

/**
 * The standard on/off switch (D11), tinted from the theme: the accent when on (a selected
 * state, rule 4), muted when off. It replaced a pill drawn here.
 */
final class Toggle {
    private Toggle() { }

    static Switch create(Context context, boolean on, String label) {
        DaylightTheme t = DaylightTheme.of(context);
        Switch s = new Switch(context);
        s.setChecked(on);
        s.setContentDescription(label);
        s.setThumbTintList(new ColorStateList(new int[][] { { android.R.attr.state_checked }, {} }, new int[] { t.primary, t.inkMuted }));
        s.setTrackTintList(new ColorStateList(new int[][] { { android.R.attr.state_checked }, {} },
                new int[] { DaylightTheme.withAlpha(t.primary, 0x66), t.track }));
        return s;
    }
}
