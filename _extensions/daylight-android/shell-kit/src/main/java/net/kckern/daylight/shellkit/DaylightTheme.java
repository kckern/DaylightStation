package net.kckern.daylight.shellkit;

import android.content.Context;
import android.content.res.ColorStateList;
import android.content.res.Configuration;
import android.content.res.Resources;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.util.TypedValue;
import android.widget.TextView;

/**
 * The one place a native screen gets its colors, type and corner radii from.
 *
 * <p>Seven seed colors are resources in this module ({@code res/values} for the default
 * light theme, {@code res/values-night} for dark), so Android picks the set from the
 * phone's dark-mode setting; {@link ThemeColors} computes every other color from them.
 * A device file's {@code theme:} block overrides seeds for that build (buildSrc
 * ThemeSource generates the resources; they outrank these), and its {@code theme.mode}
 * can hold a build to light or dark whatever the phone says: an activity applies that in
 * {@code attachBaseContext(DaylightTheme.wrap(base))}.
 *
 * <p>Screens never write a color literal: they read {@code theme.primary},
 * {@code theme.surface} and so on, and style text by role ({@link Type}). A screen about
 * one piece of media can take its colors from the cover with {@link #withAccent(int)}.
 */
public final class DaylightTheme {

    /** Text roles. Sizes are the {@code daylight_type_*} dimensions. */
    public enum Type { NUMERAL, DISPLAY, HEADLINE, TITLE, BODY, LABEL, CAPTION }

    /** Corner radii: small for rows and badges, medium for cards and sheets, large for pills. */
    public enum Radius { SMALL, MEDIUM, LARGE }

    public final ThemeColors colors;
    public final boolean dark;
    public final int background, surface, surfaceVariant, tile;
    public final int ink, inkMuted, outline;
    public final int primary, onPrimary, secondary, onSecondary;
    public final int danger, attention, attentionContainer;
    public final int disabled, ripple, scrim, track, trackBuffered;

    private final Resources res;
    private final Typeface regular, bold;

    private DaylightTheme(Resources res, Typeface regular, Typeface bold, ThemeColors c) {
        this.res = res;
        this.regular = regular;
        this.bold = bold;
        colors = c;
        dark = c.dark;
        background = c.background;
        surface = c.surface;
        surfaceVariant = c.surfaceVariant;
        tile = c.tile;
        ink = c.ink;
        inkMuted = c.inkMuted;
        outline = c.outline;
        primary = c.primary;
        onPrimary = c.onPrimary;
        secondary = c.secondary;
        onSecondary = c.onSecondary;
        danger = c.danger;
        attention = c.attention;
        attentionContainer = c.attentionContainer;
        disabled = c.disabled;
        ripple = c.ripple;
        scrim = c.scrim;
        track = c.track;
        trackBuffered = c.trackBuffered;
    }

    /** The theme as {@code context} resolves it (its configuration decides light or dark). */
    public static DaylightTheme of(Context context) {
        Resources res = context.getResources();
        boolean dark = (res.getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        ThemeColors c = new ThemeColors(dark,
                context.getColor(R.color.daylight_background),
                context.getColor(R.color.daylight_surface),
                context.getColor(R.color.daylight_ink),
                context.getColor(R.color.daylight_primary),
                context.getColor(R.color.daylight_secondary),
                context.getColor(R.color.daylight_danger),
                context.getColor(R.color.daylight_attention));
        String family = context.getString(R.string.daylight_font_family);
        return new DaylightTheme(res, Typeface.create(family, Typeface.NORMAL), Typeface.create(family, Typeface.BOLD), c);
    }

    /** This theme tinted by a cover's color ({@link CoverColor}); itself for {@link CoverColor#NONE}. */
    public DaylightTheme withAccent(int cover) {
        if (cover == CoverColor.NONE) return this;
        return new DaylightTheme(res, regular, bold, colors.withAccent(cover));
    }

    /**
     * {@code base}, or a context held to light or dark when the build's
     * {@code daylight_theme_mode} says so. For {@code Activity.attachBaseContext}, so the
     * window theme follows too.
     */
    public static Context wrap(Context base) {
        int night = nightMode(base.getString(R.string.daylight_theme_mode));
        if (night == 0) return base;
        Configuration config = new Configuration(base.getResources().getConfiguration());
        config.uiMode = (config.uiMode & ~Configuration.UI_MODE_NIGHT_MASK) | night;
        return base.createConfigurationContext(config);
    }

    /** The night bits a mode forces, or 0 for "system" (and anything unrecognised). */
    static int nightMode(String mode) {
        if ("dark".equals(mode)) return Configuration.UI_MODE_NIGHT_YES;
        if ("light".equals(mode)) return Configuration.UI_MODE_NIGHT_NO;
        return 0;
    }

    /** The AlertDialog theme to pass to {@code new AlertDialog.Builder(context, theme)}. */
    public static int alert() { return R.style.Theme_Daylight_Alert; }

    public Typeface face(boolean isBold) { return isBold ? bold : regular; }

    /** A text size in sp. */
    public float size(Type type) {
        return res.getDimension(typeDimen(type)) / res.getDisplayMetrics().scaledDensity;
    }

    /** Sets role, color and weight on {@code view}, and returns it. */
    public <T extends TextView> T style(T view, Type type, int color, boolean isBold) {
        view.setTextSize(TypedValue.COMPLEX_UNIT_SP, size(type));
        view.setTextColor(color);
        view.setTypeface(face(isBold));
        return view;
    }

    /** A new TextView in {@code type}. */
    public TextView text(Context context, CharSequence text, Type type, int color, boolean isBold) {
        TextView view = new TextView(context);
        view.setText(text);
        return style(view, type, color, isBold);
    }

    public float radius(Radius radius) {
        switch (radius) {
            case SMALL: return res.getDimension(R.dimen.daylight_radius_small);
            case LARGE: return res.getDimension(R.dimen.daylight_radius_large);
            default: return res.getDimension(R.dimen.daylight_radius_medium);
        }
    }

    /** A filled rounded rectangle. */
    public GradientDrawable round(int color, Radius radius) {
        return round(color, radius(radius));
    }

    /** A filled rounded rectangle with a radius in pixels (a fully round shape, say). */
    public static GradientDrawable round(int color, float radiusPx) {
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(color);
        shape.setCornerRadius(radiusPx);
        return shape;
    }

    /** {@code fill} with the theme's touch ripple over it. */
    public Drawable pressable(Drawable fill) {
        return new RippleDrawable(ColorStateList.valueOf(ripple), fill, null);
    }

    /** {@code color} at {@code alpha} (0-255). */
    public static int withAlpha(int color, int alpha) { return ThemeColors.alpha(color, alpha); }

    private static int typeDimen(Type type) {
        switch (type) {
            case NUMERAL: return R.dimen.daylight_type_numeral;
            case DISPLAY: return R.dimen.daylight_type_display;
            case HEADLINE: return R.dimen.daylight_type_headline;
            case TITLE: return R.dimen.daylight_type_title;
            case LABEL: return R.dimen.daylight_type_label;
            case CAPTION: return R.dimen.daylight_type_caption;
            default: return R.dimen.daylight_type_body;
        }
    }
}
