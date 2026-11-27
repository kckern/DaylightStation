package net.kckern.daylight.shellkit;

import android.app.Activity;
import android.app.Dialog;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.Window;
import android.view.WindowManager;
import android.widget.LinearLayout;

/**
 * The app's one modal sheet (design sweep D17): a scrim behind, a drag handle, a panel that
 * slides up from the bottom and goes on a swipe down, a tap on the scrim or Back. The item
 * sheet, the Play on picker and the speed sheet are built on it, so every sheet in the app
 * looks and closes the same way.
 *
 * <p>{@link #anchorAbove} turns it into a compact card over a control (the speed sheet over
 * the speed button): rounded on all corners, inset from the edges, its bottom just above
 * the control when it fits there.
 */
public final class BottomSheet {
    private final Activity activity;
    private final DaylightTheme t;
    private final Dialog dialog;
    private final Panel panel;
    private final LinearLayout body;
    private View anchor;
    private Runnable dismissed;

    public BottomSheet(Activity activity) {
        this.activity = activity;
        t = DaylightTheme.of(activity);
        dialog = new Dialog(activity);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        panel = new Panel(activity);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(0, dp(8), 0, dp(12));
        View handle = new View(activity);
        handle.setBackground(DaylightTheme.round(DaylightTheme.withAlpha(t.inkMuted, 0x66), dp(2)));
        LinearLayout.LayoutParams hp = new LinearLayout.LayoutParams(dp(32), dp(4));
        hp.gravity = Gravity.CENTER_HORIZONTAL;
        hp.bottomMargin = dp(8);
        panel.addView(handle, hp);
        handle.setContentDescription("Drag down to close");
        body = new LinearLayout(activity);
        body.setOrientation(LinearLayout.VERTICAL);
        panel.addView(body, new LinearLayout.LayoutParams(-1, -2));
        dialog.setContentView(panel);
        dialog.setCanceledOnTouchOutside(true);
        dialog.setOnDismissListener(d -> { if (dismissed != null) dismissed.run(); });
        shape(false);
    }

    /** The column the sheet's content goes in. */
    public LinearLayout body() { return body; }

    public DaylightTheme theme() { return t; }

    public BottomSheet onDismiss(Runnable r) { dismissed = r; return this; }

    /** A compact card whose bottom sits just above {@code control} (when there is room). */
    public BottomSheet anchorAbove(View control) { anchor = control; shape(true); return this; }

    private void shape(boolean card) {
        float r = t.radius(DaylightTheme.Radius.LARGE);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(t.surface);
        bg.setCornerRadii(card ? new float[] { r, r, r, r, r, r, r, r } : new float[] { r, r, r, r, 0, 0, 0, 0 });
        panel.setBackground(bg);
    }

    public void show() {
        Window w = dialog.getWindow();
        if (w != null) {
            w.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
            w.setDimAmount(0.45f);
            w.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
            w.setWindowAnimations(android.R.style.Animation_InputMethod);
            w.setGravity(Gravity.BOTTOM);
            if (anchor != null && anchor.isAttachedToWindow()) {
                int[] at = new int[2];
                anchor.getLocationOnScreen(at);
                int screenH = activity.getResources().getDisplayMetrics().heightPixels;
                WindowManager.LayoutParams lp = w.getAttributes();
                lp.width = WindowManager.LayoutParams.MATCH_PARENT;
                lp.height = WindowManager.LayoutParams.WRAP_CONTENT;
                // Above the control: the window's bottom edge sits a little over its top.
                lp.y = Math.max(dp(8), screenH - at[1] + dp(8));
                if (lp.y > screenH / 2) lp.y = dp(8);   // no room above: an inset card at the bottom
                w.setAttributes(lp);
                w.getDecorView().setPadding(dp(12), 0, dp(12), 0);
            } else {
                w.setLayout(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.WRAP_CONTENT);
                w.getDecorView().setPadding(0, 0, 0, 0);
            }
        }
        dialog.show();
    }

    public void dismiss() {
        if (dialog.isShowing()) dialog.dismiss();
    }

    public boolean showing() { return dialog.isShowing(); }

    private int dp(int v) { return Math.round(v * activity.getResources().getDisplayMetrics().density); }

    /**
     * The panel: follows a finger dragging down (from anywhere on it, rows included, once the
     * move is clearly vertical) and closes past a third of its height or on a fling.
     */
    private final class Panel extends LinearLayout {
        private float downY, downX;
        private long downAt;
        private boolean dragging;
        private final int slop;

        Panel(Activity a) {
            super(a);
            slop = ViewConfiguration.get(a).getScaledTouchSlop();
        }

        @Override public boolean onInterceptTouchEvent(MotionEvent e) {
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    downY = e.getRawY(); downX = e.getRawX(); downAt = e.getEventTime(); dragging = false;
                    return false;
                case MotionEvent.ACTION_MOVE: {
                    float dy = e.getRawY() - downY, dx = Math.abs(e.getRawX() - downX);
                    if (dy > slop * 2 && dy > dx * 1.5f && !scrolledChild(this)) { dragging = true; return true; }
                    return false;
                }
                default: return false;
            }
        }

        @Override public boolean onTouchEvent(MotionEvent e) {
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    downY = e.getRawY(); downAt = e.getEventTime();
                    return true;
                case MotionEvent.ACTION_MOVE:
                    setTranslationY(Math.max(0, e.getRawY() - downY));
                    return true;
                case MotionEvent.ACTION_UP: {
                    float dy = e.getRawY() - downY;
                    long ms = Math.max(1, e.getEventTime() - downAt);
                    boolean fling = dy / ms > 1.2f && dy > dp(24);
                    if (dy > getHeight() / 3f || fling) {
                        animate().translationY(getHeight()).setDuration(140).withEndAction(BottomSheet.this::dismiss).start();
                    } else {
                        animate().translationY(0).setDuration(140).start();
                    }
                    dragging = false;
                    return true;
                }
                case MotionEvent.ACTION_CANCEL:
                    animate().translationY(0).setDuration(140).start();
                    dragging = false;
                    return true;
                default: return true;
            }
        }

        /** A scrolling list inside that is not at its top: its own scroll wins over the drag. */
        private boolean scrolledChild(android.view.ViewGroup g) {
            for (int i = 0; i < g.getChildCount(); i++) {
                View c = g.getChildAt(i);
                if (c instanceof android.widget.ScrollView && c.canScrollVertically(-1)) return true;
                if (c instanceof android.view.ViewGroup && scrolledChild((android.view.ViewGroup) c)) return true;
            }
            return false;
        }
    }
}
