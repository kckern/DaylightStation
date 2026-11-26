package net.kckern.daylight.shellkit;

/**
 * The one color a piece of cover art is "about", for tinting Now playing the way the
 * best players do. Takes the pixels of a small copy of the image (a 32 x 32 scale-down
 * is plenty) and returns the strongest lively hue, weighted toward saturated pixels, or
 * {@link #NONE} when the image is greyscale or the color is a speck (the theme's own
 * primary then stands).
 *
 * <p>Pure: callers scale the bitmap and pass {@code getPixels}.
 */
public final class CoverColor {
    public static final int NONE = 0;
    private static final int BUCKETS = 24;
    /** The winning hue must carry at least this share of the image's pixels' worth of weight. */
    static final double MIN_SHARE = 0.03;

    private CoverColor() {}

    public static int of(int[] pixels) {
        double[] weight = new double[BUCKETS];
        double[] r = new double[BUCKETS], g = new double[BUCKETS], b = new double[BUCKETS];
        int counted = 0;
        for (int p : pixels) {
            if (((p >>> 24) & 0xff) < 0x80) continue;
            counted++;
            int pr = (p >> 16) & 0xff, pg = (p >> 8) & 0xff, pb = p & 0xff;
            int max = Math.max(pr, Math.max(pg, pb)), min = Math.min(pr, Math.min(pg, pb));
            if (max < 40) continue;                                   // near black
            double sat = (max - min) / (double) max;
            if (sat < 0.22) continue;                                 // grey or near white
            int bucket = (int) (hue(pr, pg, pb, max, min) / 360.0 * BUCKETS) % BUCKETS;
            double w = sat * sat * (0.5 + max / 510.0);
            weight[bucket] += w;
            r[bucket] += pr * w;
            g[bucket] += pg * w;
            b[bucket] += pb * w;
        }
        if (counted == 0) return NONE;
        int best = 0;
        for (int i = 1; i < BUCKETS; i++) if (window(weight, i) > window(weight, best)) best = i;
        // A fully saturated mid-bright pixel weighs about 0.75; the hue must cover MIN_SHARE of such pixels.
        if (weight[best] == 0 || window(weight, best) < MIN_SHARE * counted * 0.75) return NONE;
        double w = weight[best];
        return 0xff000000 | ((int) (r[best] / w) << 16) | ((int) (g[best] / w) << 8) | (int) (b[best] / w);
    }

    /** A hue and half of each neighbour: a gradient across two buckets is still one color. */
    private static double window(double[] weight, int i) {
        return weight[i] + 0.5 * (weight[(i + 1) % BUCKETS] + weight[(i + BUCKETS - 1) % BUCKETS]);
    }

    private static double hue(int r, int g, int b, int max, int min) {
        if (max == min) return 0;
        double d = max - min, h;
        if (max == r) h = ((g - b) / d) % 6;
        else if (max == g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
        return h < 0 ? h + 360 : h;
    }
}
