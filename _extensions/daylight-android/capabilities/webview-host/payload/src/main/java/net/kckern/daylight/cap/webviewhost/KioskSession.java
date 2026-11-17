package net.kckern.daylight.cap.webviewhost;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.TextView;

import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import androidx.webkit.WebViewRenderProcess;
import androidx.webkit.WebViewRenderProcessClient;

import net.kckern.daylight.api.KioskController;
import net.kckern.daylight.api.KioskHost;
import net.kckern.daylight.core.CoreContext;
import net.kckern.daylight.core.MainThread;
import net.kckern.daylight.core.Replies;
import net.kckern.daylight.core.spi.AppLaunch;
import net.kckern.daylight.core.spi.DeviceAdminAccess;
import net.kckern.daylight.core.spi.KioskSurface;
import net.kckern.daylight.core.spi.LockdownControl;
import net.kckern.daylight.core.spi.ScreenControl;
import net.kckern.daylight.core.spi.VolumeControl;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * The payload side of the kiosk window: owns the WebView, the page bridge, the two
 * overlay layers and page-load recovery, and is driven by the shell's KioskActivity
 * through KioskController.
 *
 * Threading: a payload starts on a worker thread with no Looper, so nothing here
 * touches a view from start(). Everything that touches a view, a window or the WebView
 * runs on the main thread: the Activity calls the KioskController methods there, and
 * route handlers and the bridge reach in through ui.post / MainThread.call. Fields
 * read from other threads are volatile.
 */
final class KioskSession implements KioskController, KioskSurface {
    static final String KIOSK_ACTIVITY = "net.kckern.daylight.cap.webviewhost.shell.KioskActivity";
    static final String DEFAULT_BACK_MODE = "reload";
    static final String NOT_CONFIGURED = "webview.startUrl is not set";

    @SuppressWarnings("deprecation")
    private static final int IMMERSIVE = View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;

    private final CoreContext core;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final LoadTracker loads = new LoadTracker();
    private final UnresponsiveTracker hung = new UnresponsiveTracker();
    private final String token = newToken();
    private final ExecutorService bridgeExec = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "daylight-bridge");
        t.setDaemon(true);
        return t;
    });

    private volatile Context app;
    private volatile KioskHost host;
    private volatile BridgeDispatcher dispatcher;
    private volatile OriginPolicy origins = OriginPolicy.fromSettings("", "");
    private volatile TouchObserver touches;
    private volatile boolean resumed, rendererAlive, errorPage, keepScreenOn, immersive;
    private volatile String mainUrl = "", intendedUrl = "", backMode = DEFAULT_BACK_MODE, lastLaunched;
    private volatile long pausedAt, lastLaunchAt;

    // Main thread only
    private Activity activity;
    private FrameLayout root;
    private WebView web;
    private View customView;
    private WebChromeClient.CustomViewCallback customCallback;
    private boolean shimAtDocumentStart;
    private Runnable retry, loadDeadline;

    // The two overlay layers. Main thread only. What is wanted is kept apart from the
    // views, so a layer drawn inside the kiosk window comes back when the Activity does.
    private String overlayText = "";
    private String overlayUrl = "";
    private String overlayGravity;
    private TextView banner;            // text layer inside the kiosk window
    private TextView systemBanner;      // text layer in a window above other apps
    private WebView overlayWeb;         // web layer, in either place
    private boolean overlayWebOverApps;
    private String overlayWebUrl;
    private String overlayWebGravity;

    KioskSession(CoreContext core) { this.core = core; }

    void start(Context context) { app = context.getApplicationContext(); }

    KioskHost host() { return host; }

    // ── settings ──────────────────────────────────────────────────────────────

    private String str(String key) { return (String) core.settings().get(key); }
    private int integer(String key) { return (Integer) core.settings().get(key); }
    private boolean bool(String key) { return (Boolean) core.settings().get(key); }

    private String startUrl() { return str("webview.startUrl").trim(); }

    private void note(String message) {
        if (core.shell() != null) core.shell().note("KIOSK", message);
    }

    private static String newToken() {
        byte[] b = new byte[16];
        new SecureRandom().nextBytes(b);
        StringBuilder s = new StringBuilder();
        for (byte x : b) s.append(String.format("%02x", x));
        return s.toString();
    }

    // ── KioskController (main thread) ─────────────────────────────────────────

    @Override public void onHostAttached(KioskHost h) {
        host = h;
        activity = (Activity) h.activity();
        root = new TouchRoot(activity);
        root.setBackgroundColor(Color.BLACK);
        banner = bannerView(activity);
        banner.setVisibility(View.GONE);
        root.addView(banner, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP));
        activity.setContentView(root);
        String mode = str("webview.backButton");
        backMode = KeyRouter.validBackMode(mode) ? mode : DEFAULT_BACK_MODE;
        buildWebView();
        applyWindowFlags();
        String start = startUrl();
        if (start.isEmpty()) showNotConfigured(); else load(start);
        // A layer that was drawn inside the previous Activity's window is drawn again in this one.
        renderText();
        renderWeb();
        note("attached to the kiosk activity");
    }

    @Override public void onHostDetached() {
        cancelRetry();
        cancelDeadline();
        destroyWebView();
        if (!overlayWebOverApps) removeOverlayWeb();
        root = null;
        banner = null;
        activity = null;
        host = null;
        resumed = false;
    }

    @Override public void onHostVisible(boolean visible) {
        if (web == null) return;
        // onPause does not stop JavaScript; it lets the WebView drop what it can while another app is in front.
        if (visible) web.onResume(); else web.onPause();
    }

    @Override public void onHostResumed() {
        resumed = true;
        applyWindowFlags();
        long now = System.currentTimeMillis();
        LockdownControl lc = core.services().find(LockdownControl.class);
        String from = lc == null ? null : lc.lastAway();
        if (from == null) from = lastLaunched;
        try {
            emit("resume", new JSONObject().put("awayMs", pausedAt == 0 ? 0 : now - pausedAt)
                    .put("from", from == null ? JSONObject.NULL : from));
        } catch (Exception ignored) { }
    }

    @Override public void onHostPaused() {
        resumed = false;
        pausedAt = System.currentTimeMillis();
        String to = pausedAt - lastLaunchAt < 3000 ? lastLaunched : null;
        try { emit("pause", new JSONObject().put("to", to == null ? JSONObject.NULL : to)); } catch (Exception ignored) { }
    }

    @Override public void onHostWindowFocus(boolean focused) {
        if (focused) applyWindowFlags();
        try { core.events().publish("kiosk-focus", new JSONObject().put("focused", focused)); } catch (Exception ignored) { }
    }

    @Override public boolean onHostKey(Object keyEvent) {
        KeyEvent ev = (KeyEvent) keyEvent;
        int action = ev.getAction();
        if (action != KeyEvent.ACTION_DOWN && action != KeyEvent.ACTION_UP) return false;
        boolean down = action == KeyEvent.ACTION_DOWN;
        if (ev.getKeyCode() == KeyEvent.KEYCODE_BACK && customView != null) {
            if (!down) hideCustomView();
            return true;
        }
        KeyRouter.Decision d = KeyRouter.route(ev.getKeyCode(), down, backMode,
                KeyRouter.parseIntercept(str("webview.interceptKeys")));
        try {
            switch (d.kind) {
                case PASS: return false;
                case CONSUME: return true;
                case PAGE_KEY:
                    if (ev.getRepeatCount() == 0) emit("key", new JSONObject().put("code", d.code).put("action", d.action));
                    return true;
                case BACK_EVENT: emit("back", new JSONObject()); return true;
                case HISTORY:
                    // Not a kiosk: Back leaves the app once the page history is used up.
                    if (web != null && web.canGoBack()) web.goBack();
                    else if (activity != null) activity.moveTaskToBack(true);
                    return true;
                case RELOAD:
                    if (web != null) {
                        String target = reloadTarget();
                        if (!target.isEmpty()) load(target);
                    }
                    return true;
                default: return false;
            }
        } catch (Exception e) {
            return true;
        }
    }

    @Override public void onHostNewIntent(Object intent) { /* a recall; nothing to do */ }

    // ── the WebView (main thread) ─────────────────────────────────────────────

    /**
     * RestrictedApi: androidx.webkit 1.6.1 ships addDocumentStartJavaScript and its
     * feature flag marked for library use only (1.7.0 and 1.8.0 mark them the same way).
     * The call is made only when the WebView reports the feature, inside a try, and the
     * evaluateJavascript path in PageClient covers a WebView or a library without it.
     */
    @android.annotation.SuppressLint({ "RestrictedApi", "SetJavaScriptEnabled" })
    private void buildWebView() {
        WebView.setWebContentsDebuggingEnabled(bool("webview.debugging"));
        origins = OriginPolicy.fromSettings(str("webview.bridgeOrigins"), startUrl());
        dispatcher = new BridgeDispatcher(token, origins, () -> mainUrl, new PageActions());
        web = new WebView(activity);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportMultipleWindows(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSafeBrowsingEnabled(false);
        s.setMixedContentMode(bool("webview.allowMixedContent")
                ? WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE : WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        web.setBackgroundColor(Color.BLACK);
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        web.setWebViewClient(new PageClient());
        web.setWebChromeClient(new ChromeClient());
        // Visible to every frame of every page. It answers only to the token the shim holds.
        web.addJavascriptInterface(new NativeBridge(), BridgeScript.NATIVE_NAME);

        shimAtDocumentStart = false;
        if (!origins.rules().isEmpty() && WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            try {
                WebViewCompat.addDocumentStartJavaScript(web, shim(), origins.rules());
                shimAtDocumentStart = true;
            } catch (Throwable t) {
                note("document-start script refused: " + t);
            }
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_VIEW_RENDERER_CLIENT_BASIC_USAGE)) {
            WebViewCompat.setWebViewRenderProcessClient(web, new WebViewRenderProcessClient() {
                @Override public void onRenderProcessUnresponsive(WebView view, WebViewRenderProcess renderer) {
                    long now = System.currentTimeMillis();
                    hung.unresponsive(now);
                    if (view != web || !hung.shouldTerminate(now, integer("recovery.rendererUnresponsiveSec"))) return;
                    note("renderer unresponsive past the limit; ending it");
                    hung.responsive();
                    if (!terminate(renderer)) rebuild("renderer unresponsive");
                }
                @Override public void onRenderProcessResponsive(WebView view, WebViewRenderProcess renderer) {
                    hung.responsive();
                }
            });
        }
        root.addView(web, 0, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        web.requestFocus();
        rendererAlive = true;
        note("webview built; bridge origins=" + origins.rules() + " shimAtDocumentStart=" + shimAtDocumentStart);
    }

    private String shim() {
        return BridgeScript.shim(token, core.payloadVersion(), core.deviceId());
    }

    private void destroyWebView() {
        hideCustomView();
        if (web == null) return;
        WebView old = web;
        web = null;
        dispatcher = null;
        rendererAlive = false;
        if (root != null) root.removeView(old);
        try { old.stopLoading(); old.removeJavascriptInterface(BridgeScript.NATIVE_NAME); old.destroy(); }
        catch (Throwable ignored) { }
    }

    /** Throw the WebView away and build another on the same URL. */
    private void rebuild(String reason) {
        if (activity == null) return;
        String url = reloadTarget();
        note("rebuilding the webview: " + reason);
        destroyWebView();
        buildWebView();
        if (url.isEmpty()) showNotConfigured(); else load(url);
    }

    private static boolean terminate(WebViewRenderProcess renderer) {
        try {
            return renderer != null
                    && WebViewFeature.isFeatureSupported(WebViewFeature.WEB_VIEW_RENDERER_TERMINATE)
                    && renderer.terminate();
        } catch (Throwable t) {
            return false;
        }
    }

    private String reloadTarget() {
        if (!errorPage && OriginPolicy.originOf(mainUrl) != null) return mainUrl;
        return intendedUrl.isEmpty() ? startUrl() : intendedUrl;
    }

    private static boolean isLocalPage(String url) {
        return url == null || url.startsWith("about:") || url.startsWith("data:");
    }

    // ── loading and recovery (main thread) ────────────────────────────────────

    private CompletableFuture<LoadTracker.Result> load(String url) { return load(url, loads.newLoadId()); }

    private CompletableFuture<LoadTracker.Result> load(String url, String loadId) {
        cancelRetry();
        intendedUrl = url;
        errorPage = false;
        final long gen = loads.begin(url, System.currentTimeMillis(), loadId);
        CompletableFuture<LoadTracker.Result> waiter = loads.waiter(gen);
        web.loadUrl(url);
        armDeadline(gen);
        return waiter;
    }

    /** A load that has not finished by the deadline is stopped and counted as a failure. */
    private void armDeadline(final long gen) {
        cancelDeadline();
        loadDeadline = () -> {
            LoadTracker.Result r = loads.timeout(gen, System.currentTimeMillis());
            if (r == null) return;
            if (web != null) web.stopLoading();
            afterSettle(r);
        };
        ui.postDelayed(loadDeadline, Math.max(1, integer("webview.loadTimeoutSec")) * 1000L);
    }

    private void cancelDeadline() {
        if (loadDeadline != null) { ui.removeCallbacks(loadDeadline); loadDeadline = null; }
    }

    private void afterSettle(LoadTracker.Result r) {
        if (r.ok) {
            errorPage = false;
            cancelRetry();
            return;
        }
        if ("superseded".equals(r.error)) return;
        long delay = RetryPolicy.delayMs(loads.failures(), integer("recovery.reloadOnPageFailureSec"),
                integer("recovery.maxRetrySec"));
        note("load failed: " + r.error + " url=" + r.url + " retryInMs=" + delay);
        showErrorPage(r.url, r.error, delay);
        if (delay >= 0) {
            retry = () -> { if (web != null && !intendedUrl.isEmpty()) load(intendedUrl); };
            ui.postDelayed(retry, delay);
        }
    }

    private void cancelRetry() {
        if (retry != null) { ui.removeCallbacks(retry); retry = null; }
    }

    private void showErrorPage(String url, String error, long retryInMs) {
        errorPage = true;
        if (web != null) web.loadDataWithBaseURL(null, ErrorPage.html(url, error, retryInMs), "text/html", "utf-8", null);
    }

    /** No start URL: say so on the screen. GET /kiosk/status reports ready:false with the reason. */
    private void showNotConfigured() {
        errorPage = true;
        note(NOT_CONFIGURED);
        if (web != null) web.loadDataWithBaseURL(null, ErrorPage.notConfigured(core.deviceId()), "text/html", "utf-8", null);
    }

    /** From the connectivity callback. */
    void networkReturned() {
        ui.post(() -> {
            if (web == null || intendedUrl.isEmpty()) return;
            if (RetryPolicy.reloadOnNetworkReturn(bool("recovery.reloadOnNetworkReturn"), loads.state())) {
                note("network returned; reloading the failed page");
                load(intendedUrl);
            }
        });
    }

    private final class PageClient extends WebViewClient {
        @Override public void onPageStarted(WebView view, String url, Bitmap favicon) {
            if (view != web || isLocalPage(url)) return;
            mainUrl = url;
            // A navigation the page started itself is tracked too, so its failure gets the same recovery.
            if (loads.state() != LoadTracker.State.LOADING) {
                intendedUrl = url;
                errorPage = false;
                armDeadline(loads.begin(url, System.currentTimeMillis()));
            } else {
                loads.redirected(url);
            }
            if (!shimAtDocumentStart && origins.allows(url)) view.evaluateJavascript(shim(), null);
        }

        @Override public void onPageFinished(WebView view, String url) {
            if (view != web || isLocalPage(url)) return;
            if (!shimAtDocumentStart && origins.allows(url)) view.evaluateJavascript(shim(), null);
            LoadTracker.Result r = loads.finished(System.currentTimeMillis());
            if (r == null) return;
            cancelDeadline();
            afterSettle(r);
        }

        @Override public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
            // Also fires for history.pushState, which onPageStarted does not see.
            if (view == web && !isLocalPage(url)) mainUrl = url;
        }

        @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (view == web && request.isForMainFrame()) {
                loads.mainFrameError(error.getErrorCode() + " " + error.getDescription());
            }
        }

        @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
            if (view == web && request.isForMainFrame() && response.getStatusCode() >= 400) {
                loads.mainFrameError("http " + response.getStatusCode());
            }
        }

        @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            String scheme = request.getUrl().getScheme();
            boolean http = "http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme);
            if (!http) note("blocked a non-http navigation: " + scheme);
            return !http;   // true = do not load. intent:, market:, tel: never leave the page this way.
        }

        @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            if (view != web) return true;   // a WebView already replaced
            rendererAlive = false;
            loads.rendererGone(System.currentTimeMillis());
            cancelDeadline();
            note("renderer gone, crashed=" + detail.didCrash());
            // Every WebView in the process may share that renderer; the web overlay is rebuilt too.
            if (overlayWeb != null) { removeOverlayWeb(); renderWeb(); }
            rebuild("renderer gone");
            return true;                     // handled: do not kill the app
        }
    }

    private final class ChromeClient extends WebChromeClient {
        @Override public void onPermissionRequest(PermissionRequest request) {
            if (!origins.allows(String.valueOf(request.getOrigin()))) {
                note("denied a media request from " + request.getOrigin());
                request.deny();
                return;
            }
            List<String> grant = new ArrayList<>();
            for (String res : request.getResources()) {
                if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res) && bool("webview.allowMic")
                        && holds(android.Manifest.permission.RECORD_AUDIO)) grant.add(res);
                if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res) && bool("webview.allowCamera")
                        && holds(android.Manifest.permission.CAMERA)) grant.add(res);
            }
            if (grant.isEmpty()) {
                note("media request not granted: " + java.util.Arrays.toString(request.getResources()));
                request.deny();
            } else {
                request.grant(grant.toArray(new String[0]));
            }
        }

        @Override public void onShowCustomView(View view, CustomViewCallback callback) {
            if (customView != null || root == null) { callback.onCustomViewHidden(); return; }
            customView = view;
            customCallback = callback;
            root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT));
            if (web != null) web.setVisibility(View.GONE);
        }

        @Override public void onHideCustomView() { hideCustomView(); }
    }

    private boolean holds(String permission) {
        Context c = app;
        return c != null && c.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }

    private void hideCustomView() {
        if (customView == null) return;
        if (root != null) root.removeView(customView);
        customView = null;
        if (web != null) web.setVisibility(View.VISIBLE);
        WebChromeClient.CustomViewCallback cb = customCallback;
        customCallback = null;
        if (cb != null) try { cb.onCustomViewHidden(); } catch (Throwable ignored) { }
    }

    private final class TouchRoot extends FrameLayout {
        TouchRoot(Context c) { super(c); }

        @Override public boolean dispatchTouchEvent(MotionEvent ev) {
            TouchObserver o = touches;
            if (o != null && ev.getActionMasked() == MotionEvent.ACTION_DOWN) {
                try { o.onTouchDown(ev.getX(), ev.getY(), getWidth(), getHeight()); } catch (Throwable ignored) { }
            }
            return super.dispatchTouchEvent(ev);
        }
    }

    @SuppressWarnings("deprecation")
    private void applyWindowFlags() {
        if (activity == null) return;
        if (keepScreenOn) activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        activity.getWindow().getDecorView().setSystemUiVisibility(immersive ? IMMERSIVE : View.SYSTEM_UI_FLAG_VISIBLE);
    }

    // ── the page bridge ───────────────────────────────────────────────────────

    /** The object addJavascriptInterface exposes. Runs on the WebView's bridge thread. */
    private final class NativeBridge {
        @JavascriptInterface public String call(String token, String method, String arg) {
            BridgeDispatcher d = dispatcher;
            return d == null ? "" : d.call(token, method, arg);
        }
    }

    /** What an accepted bridge call does. Reads answer inline; actions run on the bridge executor. */
    private final class PageActions implements BridgeDispatcher.Actions {
        @Override public String capabilitiesJson() { return new JSONArray(core.capabilityNames()).toString(); }

        @Override public boolean launch(String json) {
            AppLaunch launcher = core.services().find(AppLaunch.class);
            if (launcher == null) return false;
            final JSONObject request;
            try { request = new JSONObject(json); } catch (Exception e) { return false; }
            if (launcher.check(request) != null) return false;
            bridgeExec.execute(() -> launcher.launch(request));
            return true;
        }

        @Override public boolean screen(boolean on) {
            ScreenControl screen = core.services().find(ScreenControl.class);
            if (screen == null || (!on && !screen.canTurnOff())) return false;
            bridgeExec.execute(() -> screen.setOn(on, 3000));
            return true;
        }

        @Override public void restartApp() { restartPayloadSoon(); }

        @Override public boolean reboot() {
            DeviceAdminAccess admin = core.services().find(DeviceAdminAccess.class);
            if (admin == null || !admin.isOwner()) return false;
            bridgeExec.execute(admin::reboot);
            return true;
        }

        @Override public void setBackMode(String mode) { backMode = mode; }

        @Override public String volumeJson(int stream) {
            VolumeControl volume = core.services().find(VolumeControl.class);
            return volume == null ? "{}" : volume.read(stream).toString();
        }
    }

    /**
     * After a short delay, so the HTTP response or the bridge call returns before the
     * payload stops. On its own thread: the bridge executor is shut down by stop().
     */
    void restartPayloadSoon() {
        Thread t = new Thread(() -> {
            try { Thread.sleep(300); } catch (InterruptedException ignored) { }
            String answer = core.shell().requestPayloadRestart();
            note("payload restart requested: " + answer);
        }, "daylight-kiosk-restart");
        t.setDaemon(true);
        t.start();
    }

    /** Dispatch daylight:<name> to the page, when the page is one the bridge serves. */
    void emit(String name, JSONObject detail) {
        final String js = BridgeScript.event(name, detail.toString());
        ui.post(() -> { if (web != null && !errorPage && origins.allows(mainUrl)) web.evaluateJavascript(js, null); });
    }

    /** Called from the capability's stop(), on any thread. Does not wait for the main thread. */
    void shutdown() {
        bridgeExec.shutdown();
        ui.post(() -> {
            overlayText = "";
            overlayUrl = "";
            renderText();
            renderWeb();
        });
        KioskHost h = host;
        if (h != null) try { h.attach(null); } catch (Throwable ignored) { }
    }

    // ── the overlay layers (main thread) ──────────────────────────────────────

    private static TextView bannerView(Context c) {
        TextView t = new TextView(c);
        t.setBackgroundColor(Color.argb(220, 160, 0, 0));
        t.setTextColor(Color.WHITE);
        t.setTextSize(22);
        t.setGravity(Gravity.CENTER);
        t.setPadding(24, 24, 24, 24);
        return t;
    }

    private boolean mayDrawOverApps() {
        Context c = app;
        try { return c != null && android.provider.Settings.canDrawOverlays(c); } catch (Throwable t) { return false; }
    }

    private WindowManager windows() {
        Context c = app;
        return c == null ? null : (WindowManager) c.getSystemService(Context.WINDOW_SERVICE);
    }

    /** A window above other apps that never takes focus or touch. */
    private static WindowManager.LayoutParams overAppsWindow(int height, int gravity) {
        WindowManager.LayoutParams p = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT, height,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN | WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
                PixelFormat.TRANSLUCENT);
        p.gravity = gravity;
        return p;
    }

    /**
     * Draw the text layer as wanted. Above other apps when the SYSTEM_ALERT_WINDOW appop
     * is granted (the arcade message must be readable over a launched app), inside the
     * kiosk window otherwise. Returns whether the text is on screen.
     */
    private boolean renderText() {
        WindowManager wm = windows();
        if (systemBanner != null) {
            if (wm != null) try { wm.removeView(systemBanner); } catch (Exception ignored) { }
            systemBanner = null;
        }
        if (banner != null) { banner.setText(""); banner.setVisibility(View.GONE); }
        if (overlayText.isEmpty()) return false;
        if (wm != null && mayDrawOverApps()) {
            try {
                TextView t = bannerView(app);
                t.setText(overlayText);
                wm.addView(t, overAppsWindow(WindowManager.LayoutParams.WRAP_CONTENT, Gravity.TOP));
                systemBanner = t;
                return true;
            } catch (Throwable e) {
                note("text overlay window failed: " + e);
            }
        }
        if (banner == null) return false;
        banner.setText(overlayText);
        banner.setVisibility(View.VISIBLE);
        banner.bringToFront();
        return true;
    }

    private void removeOverlayWeb() {
        WebView old = overlayWeb;
        if (old == null) return;
        overlayWeb = null;
        try {
            if (overlayWebOverApps) {
                WindowManager wm = windows();
                if (wm != null) wm.removeView(old);
            } else if (old.getParent() instanceof ViewGroup) {
                ((ViewGroup) old.getParent()).removeView(old);
            }
        } catch (Throwable ignored) { }
        try { old.stopLoading(); old.destroy(); } catch (Throwable ignored) { }
        overlayWebOverApps = false;
        overlayWebUrl = null;
        overlayWebGravity = null;
    }

    /**
     * Draw the web layer as wanted: a second, transparent WebView that never takes focus
     * or touch and has no page bridge. Above other apps when the appop is granted, so a
     * countdown shows over a launched game; inside the kiosk window otherwise. It fills
     * the screen, because the countdown page places itself in screen coordinates;
     * gravity names the edge the window is anchored to. Returns whether it is on screen.
     */
    @android.annotation.SuppressLint("SetJavaScriptEnabled")
    private boolean renderWeb() {
        if (overlayUrl.isEmpty()) { removeOverlayWeb(); return false; }
        boolean same = overlayWeb != null && overlayUrl.equals(overlayWebUrl)
                && (overlayGravity == null ? overlayWebGravity == null : overlayGravity.equals(overlayWebGravity));
        if (same && (overlayWebOverApps || overlayWeb.getParent() == root)) return true;
        removeOverlayWeb();
        WindowManager wm = windows();
        boolean overApps = wm != null && mayDrawOverApps();
        if (!overApps && (activity == null || root == null)) return false;
        WebView w = null;
        try {
            w = new PassiveWebView(overApps ? app : activity);
            WebSettings s = w.getSettings();
            s.setJavaScriptEnabled(true);
            s.setDomStorageEnabled(true);
            s.setMediaPlaybackRequiresUserGesture(false);
            s.setSupportMultipleWindows(false);
            s.setAllowFileAccess(false);
            s.setAllowContentAccess(false);
            w.setBackgroundColor(Color.TRANSPARENT);
            w.setFocusable(false);
            w.setFocusableInTouchMode(false);
            w.setWebViewClient(new OverlayClient());
            int gravity = "top".equals(overlayGravity) ? Gravity.TOP : Gravity.BOTTOM;
            if (overApps) {
                wm.addView(w, overAppsWindow(WindowManager.LayoutParams.MATCH_PARENT, gravity));
            } else {
                root.addView(w, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT, gravity));
                if (banner != null && banner.getVisibility() == View.VISIBLE) banner.bringToFront();
            }
            w.loadUrl(overlayUrl);
            overlayWeb = w;
            overlayWebOverApps = overApps;
            overlayWebUrl = overlayUrl;
            overlayWebGravity = overlayGravity;
            return true;
        } catch (Throwable e) {
            note("web overlay failed: " + e);
            if (w != null) try { w.destroy(); } catch (Throwable ignored) { }
            return false;
        }
    }

    /** A WebView that lets every touch through to what is beneath it. */
    private static final class PassiveWebView extends WebView {
        PassiveWebView(Context c) { super(c); }
        @Override public boolean dispatchTouchEvent(MotionEvent ev) { return false; }
    }

    private final class OverlayClient extends WebViewClient {
        @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            String scheme = request.getUrl().getScheme();
            return !("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme));
        }

        @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            if (view == overlayWeb) {
                note("web overlay renderer gone; rebuilding it");
                removeOverlayWeb();
                renderWeb();
            }
            return true;   // handled: do not kill the app
        }
    }

    /** POST /kiosk/overlay. Changes only the layers the request names and reports both. */
    JSONObject overlay(final OverlayRequest request) throws Exception {
        return MainThread.call(() -> {
            if (request.setsText) overlayText = request.text;
            if (request.setsWeb) { overlayUrl = request.url; overlayGravity = request.gravity; }
            boolean textShown = renderText();
            boolean webShown = renderWeb();
            boolean missing = (request.setsText && !request.text.isEmpty() && !textShown)
                    || (request.setsWeb && !request.url.isEmpty() && !webShown);
            return OverlayRequest.answer(textShown, webShown, systemBanner != null, overlayWebOverApps,
                    overlayUrl, missing ? "overlay_not_shown" : null);
        }, 5000);
    }

    // ── for the routes (any thread) ───────────────────────────────────────────

    private static void requireHttp(String url) {
        if (url == null || OriginPolicy.originOf(url) == null) throw new IllegalArgumentException("url must be an http or https URL");
    }

    /** True when a kiosk Activity is attached, starting one and waiting briefly when it is not. */
    private boolean ensureAttached() {
        if (attached()) return true;
        return bringToFront() && MainThread.waitFor(this::attached, 5000);
    }

    LoadTracker.Result loadAndWait(final String url) throws Exception {
        requireHttp(url);
        final String loadId = loads.newLoadId();
        if (!ensureAttached()) return new LoadTracker.Result(loadId, url, false, "no_kiosk_activity", System.currentTimeMillis(), 0);
        CompletableFuture<LoadTracker.Result> f = MainThread.call(() -> web == null ? null : load(url, loadId), 5000);
        if (f == null) return new LoadTracker.Result(loadId, url, false, "no_kiosk_activity", System.currentTimeMillis(), 0);
        return f.get(integer("webview.loadTimeoutSec") + 5L, TimeUnit.SECONDS);
    }

    /**
     * The wait:false mode. Starts the load and returns at once with its id; the outcome
     * is read from lastLoad in GET /kiosk/status. Returns null when there is no kiosk
     * Activity to load into: that request is refused, not queued.
     */
    String loadAccepted(final String url) {
        requireHttp(url);
        if (!attached()) {
            bringToFront();          // the start URL loads when the Activity attaches
            return null;
        }
        final String loadId = loads.newLoadId();
        ui.post(() -> {
            if (web != null) load(url, loadId);
            else loads.refused(url, loadId, "no_kiosk_activity", System.currentTimeMillis());
        });
        return loadId;
    }

    /** What /kiosk/reload reloads. */
    String reloadUrl() throws Exception {
        String target = MainThread.call(this::reloadTarget, 5000);
        if (target.isEmpty()) throw new IllegalArgumentException(NOT_CONFIGURED);
        return target;
    }

    LoadTracker.Result resetRendererAndWait() throws Exception {
        if (!attached()) return new LoadTracker.Result(null, currentUrl(), false, "no_kiosk_activity", System.currentTimeMillis(), 0);
        CompletableFuture<LoadTracker.Result> next = loads.next();
        MainThread.call(() -> {
            boolean ended = false;
            try {
                if (web != null && WebViewFeature.isFeatureSupported(WebViewFeature.GET_WEB_VIEW_RENDERER)) {
                    ended = terminate(WebViewCompat.getWebViewRenderProcess(web));   // then onRenderProcessGone rebuilds
                }
            } catch (Throwable ignored) { }
            if (!ended) rebuild("reset requested");
            return null;
        }, 5000);
        return next.get(integer("webview.loadTimeoutSec") + 10L, TimeUnit.SECONDS);
    }

    /** The package in front: our own whenever the kiosk Activity is resumed, else the watcher's sample, else null. */
    String frontPackage() {
        Context c = app;
        if (resumed && c != null) return c.getPackageName();
        LockdownControl lc = core.services().find(LockdownControl.class);
        return lc == null ? null : lc.front();
    }

    /** The resumed activity's class, or null when it is not known. */
    String frontActivity() {
        if (resumed) return KIOSK_ACTIVITY;
        LockdownControl lc = core.services().find(LockdownControl.class);
        return lc == null ? null : lc.frontActivity();
    }

    JSONObject status() throws Exception {
        LockdownControl lc = core.services().find(LockdownControl.class);
        LoadTracker.Result last = loads.last();
        Context c = app;
        String front = frontPackage(), frontActivity = frontActivity();
        String reason = Readiness.notReadyReason(startUrl(), attached(), loads.state(), errorPage,
                last == null ? null : last.error);
        JSONObject o = Replies.ok()
                .put("ready", reason == null)
                .put("reason", reason == null ? JSONObject.NULL : reason)
                .put("currentUrl", currentUrl())
                .put("startUrl", startUrl())
                .put("screenOn", c != null && DeviceFacts.screenOn(c))
                .put("foreground", front == null ? JSONObject.NULL : front)
                .put("foregroundActivity", frontActivity == null ? JSONObject.NULL : frontActivity)
                .put("kioskInForeground", resumed)
                .put("locked", lc != null && lc.locked())
                .put("rendererAlive", rendererAlive)
                .put("errorPage", errorPage)
                .put("lastLoad", last == null ? JSONObject.NULL : last.toJson());
        // Beyond the contract's list: lets a wait:false caller tell "still loading" from "settled".
        String loading = loads.loadingUrl(), loadingId = loads.loadingId();
        o.put("loading", loading != null)
                .put("loadingUrl", loading == null ? JSONObject.NULL : loading)
                .put("loadingId", loadingId == null ? JSONObject.NULL : loadingId);
        if (c != null) DeviceFacts.addTo(o, c); else DeviceFacts.addUnknownTo(o);
        return o;
    }

    // ── KioskSurface (any thread) ─────────────────────────────────────────────

    @Override public boolean attached() { return host != null && rendererAlive; }

    @Override public boolean inForeground() { return resumed; }

    @Override public String currentUrl() { return errorPage ? intendedUrl : mainUrl; }

    @Override public Intent kioskIntent() {
        Context c = app;
        if (c == null) throw new IllegalStateException("the kiosk is not started");
        return new Intent().setClassName(c.getPackageName(), KIOSK_ACTIVITY)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
    }

    @Override public boolean bringToFront() {
        try { app.startActivity(kioskIntent()); return true; }
        catch (Exception e) { note("bringToFront failed: " + e.getMessage()); return false; }
    }

    @Override public boolean startActivity(final Intent intent) {
        try {
            Boolean ok = MainThread.call(() -> {
                if (activity != null && resumed) activity.startActivity(intent);
                else app.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                return true;
            }, 5000);
            String pkg = intent.getComponent() != null ? intent.getComponent().getPackageName() : intent.getPackage();
            lastLaunched = pkg;
            lastLaunchAt = System.currentTimeMillis();
            return ok;
        } catch (Exception e) {
            note("startActivity failed: " + e.getMessage());
            return false;
        }
    }

    @Override public String evaluate(final String js, long timeoutMs) throws Exception {
        final CompletableFuture<String> result = new CompletableFuture<>();
        ui.post(() -> {
            if (web == null) result.completeExceptionally(new IllegalStateException("no page"));
            else web.evaluateJavascript(js, result::complete);
        });
        return result.get(timeoutMs, TimeUnit.MILLISECONDS);
    }

    @Override public byte[] capturePng() throws Exception {
        return MainThread.call(() -> {
            if (web == null || web.getWidth() == 0 || web.getHeight() == 0) throw new IllegalStateException("no page to capture");
            Bitmap bitmap = Bitmap.createBitmap(web.getWidth(), web.getHeight(), Bitmap.Config.ARGB_8888);
            // The WebView's own drawing. A video surface or another app's window is not in it.
            web.draw(new Canvas(bitmap));
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, out);
            bitmap.recycle();
            return out.toByteArray();
        }, 10_000);
    }

    @Override public void setKeepScreenOn(boolean on) { keepScreenOn = on; ui.post(this::applyWindowFlags); }

    @Override public void setImmersive(boolean on) { immersive = on; ui.post(this::applyWindowFlags); }

    @Override public void setLockTask(final boolean on) {
        ui.post(() -> {
            if (activity == null) return;
            try { if (on) activity.startLockTask(); else activity.stopLockTask(); }
            catch (Exception e) { note("lock task " + (on ? "start" : "stop") + " failed: " + e.getMessage()); }
        });
    }

    @Override public void observeTouches(TouchObserver observer) { touches = observer; }

    @Override public void promptPin(final String title, final PinCallback callback) {
        ui.post(() -> {
            if (activity == null) return;
            final EditText input = new EditText(activity);
            input.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD);
            new AlertDialog.Builder(activity).setTitle(title).setView(input)
                    .setPositiveButton(android.R.string.ok, (dialog, which) -> callback.onPin(input.getText().toString()))
                    .setNegativeButton(android.R.string.cancel, null)
                    .show();
        });
    }
}
