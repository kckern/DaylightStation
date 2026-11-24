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
import net.kckern.daylight.core.spi.MediaPinner;
import net.kckern.daylight.core.spi.ScreenControl;
import net.kckern.daylight.core.spi.VolumeControl;

import org.json.JSONArray;
import net.kckern.daylight.core.spi.PianoKioskTools;
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
final class KioskSession implements KioskController, KioskSurface, net.kckern.daylight.core.spi.PageOpener {
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
    /** Whether the document in the page was opened by a link from outside the app. */
    private final DocumentTrust trust = new DocumentTrust();
    /** What the shim spends on a token for its document. Never passed with a call. */
    private final String sessionKey = newToken();
    private final BridgeTokens tokens = new BridgeTokens(sessionKey);
    private final RendererLossPolicy rendererLosses = new RendererLossPolicy();
    private final NavigationPolicy.BounceGuard bounces = new NavigationPolicy.BounceGuard();
    /** Said once per payload: a WebView that cannot inject at document start gets no bridge. */
    private boolean bridgeUnavailableNoted;
    private final ExecutorService bridgeExec = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "daylight-bridge");
        t.setDaemon(true);
        return t;
    });

    private volatile Context app;
    private volatile KioskHost host;
    private volatile BridgeDispatcher dispatcher;
    /** pinMedia's limit and its count of refusals, kept across WebView rebuilds. */
    private final PinGate pinGate = new PinGate(System::currentTimeMillis);
    private volatile OriginPolicy origins = OriginPolicy.fromSettings("", "");
    private volatile NavigationPolicy navigation = NavigationPolicy.of("");
    /** Null until a WebView has been built. */
    private volatile BridgeAvailability bridge;
    /** The renderer was ended on request (POST /kiosk/renderer/reset): not a crash to count. */
    private boolean resetRequested;
    private volatile TouchObserver touches;
    private String shortcutLaunch;
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

    /** A setting another capability declares, or "" when that capability is not in this build. */
    private String foreign(String key) {
        try { return String.valueOf(core.settings().get(key)); }
        catch (net.kckern.daylight.core.SettingsRegistry.UnknownSettingException notInThisBuild) { return ""; }
    }

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
        // The device file's decision; the Activity shows nothing over a lock screen until told.
        if (!LockScreenRule.apply(h, bool("webview.showWhenLocked"))) note("this shell cannot be told webview.showWhenLocked");
        // A link, or a load asked for with wait:false, that arrived with no window up is
        // why this Activity was opened: show it, under the id its caller was given.
        shortcutLaunch = null;
        if (!openPendingLink(false)) {
            trust.loadedByApp();
            String start = startUrl();
            if (start.isEmpty()) showNotConfigured(); else load(start);
        }
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
        requestedCallPermissions.clear();
        activity = null;
        host = null;
        resumed = false;
    }

    @Override public void onHostVisible(boolean visible) {
        if (web == null) return;
        // onPause does not stop JavaScript; it lets the WebView drop what it can while another app is in front.
        if (visible) {
            web.onResume();
        } else {
            if ("phone".equals(core.deviceId())) {
                clearCallRequests();
                notifyPhoneHidden();
            }
            web.onPause();
        }
    }

    @Override public void onHostResumed() {
        resumed = true;
        openPendingLink(true);
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
        clearPortalFrames();
        pausedAt = System.currentTimeMillis();
        String to = pausedAt - lastLaunchAt < 3000 ? lastLaunched : null;
        try { emit("pause", new JSONObject().put("to", to == null ? JSONObject.NULL : to)); } catch (Exception ignored) { }
    }

    @Override public void onHostWindowFocus(boolean focused) {
        windowFocused = focused;
        if (!focused) clearPortalFrames();
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
                    if ("phone".equals(core.deviceId()) && (errorPage && shortcutLaunch != null
                            || CallCapturePolicy.serviceRoot(shortcutLaunch, mainUrl))) finishPhoneShortcut();
                    else if (web != null && web.canGoBack()) web.goBack();
                    else if (activity != null) activity.finish();
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

    @Override public void onHostNewIntent(Object intent) { openPendingLink(true); }

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
        // The phone lists the origins its links may open; they may be navigated to as well.
        navigation = NavigationPolicy.of(startUrl(), str("webview.allowedOrigins"), foreign("links.origins"));
        web = new WebView(activity);
        installPhoneShortcutListener(web);
        WebSettings s = web.getSettings();
        s.setUserAgentString(s.getUserAgentString() + " DaylightKiosk/1");
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
        web.setWebChromeClient(new ChromeClient(web));
        // The bridge exists only where its shim can be injected at document start, into
        // frames of an allowed origin. There is no fallback: evaluating the shim when a
        // load starts runs it in the outgoing document, whatever its origin.
        boolean supported = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT);
        String refused = null;
        shimAtDocumentStart = false;
        if (!origins.rules().isEmpty() && supported) {
            try {
                WebViewCompat.addDocumentStartJavaScript(web, shim(), origins.rules());
                shimAtDocumentStart = true;
            } catch (Throwable t) {
                refused = String.valueOf(t);
            }
        }
        BridgeAvailability availability = BridgeAvailability.decide(!origins.rules().isEmpty(), supported, refused);
        bridge = availability;
        if (availability.available) {
            dispatcher = new BridgeDispatcher(tokens, origins, () -> mainUrl, new PageActions(), pinGate);
            // Visible to every frame of every page. It answers only to a token, and a
            // token is issued only for the key the document-start shim carries.
            web.addJavascriptInterface(new NativeBridge(dispatcher), BridgeScript.NATIVE_NAME);
        } else {
            dispatcher = null;
            if (!bridgeUnavailableNoted) {
                bridgeUnavailableNoted = true;
                note("page bridge unavailable: " + availability.reason);
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
        note("webview built; bridge=" + availability.state() + " origins=" + origins.rules()
                + " navigation=" + navigation.origins());
    }

    @android.annotation.SuppressLint("RestrictedApi")
    private void installPhoneShortcutListener(WebView view) {
        String origin = OriginPolicy.originOf(startUrl());
        if (!"phone".equals(core.deviceId()) || origin == null || !origin.startsWith("https://")
                || !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)
                || !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return;
        java.util.Set<String> site = java.util.Collections.singleton(origin);
        try {
            WebViewCompat.addWebMessageListener(view, "DaylightPhoneShortcut", site, (sender, message, source, mainFrame, reply) -> {
                if (sender != web || !resumed || !documentCommitted || errorPage) return;
                String requester = source.toString();
                if (("barcode-done".equals(message.getData()) || "barcode-beep".equals(message.getData()))
                        && CallCapturePolicy.allowsBarcode(startUrl(), committingUrl, requester, false)
                        && CallCapturePolicy.finishesBarcode(
                        core.deviceId(), startUrl(), shortcutLaunch, mainUrl, requester,
                        mainFrame, trust.openedFromOutside())) {
                    if ("barcode-done".equals(message.getData())) finishPhoneShortcut();
                    else playBarcodeTone();
                }
                if ("call-exit".equals(message.getData()) && mainFrame
                        && CallCapturePolicy.allows(startUrl(), mainUrl, requester, false))
                    finishPhoneShortcut();
            });
            WebViewCompat.addDocumentStartJavaScript(view, "(function(){if(window!==window.top)return;"
                    + "var bridge=window.DaylightPhoneShortcut;if(!bridge)return;"
                    + "if(location.pathname==='/health'&&location.search==='?capture=barcode')"
                    + "window.addEventListener('daylight:barcode-shortcut-done',function(){bridge.postMessage('barcode-done');},{once:true});"
                    + "window.addEventListener('daylight:call-exit',function(){"
                    + "if(location.pathname==='/call'||location.pathname==='/call/')bridge.postMessage('call-exit');});})();", site);
        } catch (RuntimeException unsupported) {
            note("phone shortcut completion bridge unavailable");
        }
    }

    private void playBarcodeTone() {
        try {
            android.media.ToneGenerator tone = new android.media.ToneGenerator(
                    android.media.AudioManager.STREAM_MUSIC, 65);
            tone.startTone(android.media.ToneGenerator.TONE_PROP_ACK, 140);
            new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(tone::release, 220);
        } catch (RuntimeException unavailable) {
            note("barcode scan tone unavailable");
        }
    }

    private void notifyPhoneHidden() {
        if (web != null && !errorPage && origins.allows(mainUrl))
            web.evaluateJavascript(BridgeScript.event("hidden", "{}"), null);
    }

    private void finishPhoneShortcut() {
        if (activity == null || activity.isFinishing()) return;
        shortcutLaunch = null;
        notifyPhoneHidden();
        try {
            activity.startActivity(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (RuntimeException unavailable) {
            activity.moveTaskToBack(true);
        }
        activity.finish();
    }

    private volatile boolean windowFocused, documentCommitted;
    private String committingUrl;
    private final PortalPageInput portalVolume = new PortalPageInput();
    private final PortalPageInput portalKeyboard = new PortalPageInput();

    private boolean trustedKioskPage() {
        String start = OriginPolicy.originOf(startUrl());
        return !midiStopped && documentCommitted && rendererAlive && !errorPage && !trust.openedFromOutside()
                && start != null && start.equals(OriginPolicy.originOf(mainUrl)) && origins.allows(mainUrl);
    }

    private boolean visibleKioskPage() { return resumed && windowFocused && trustedKioskPage(); }

    private void clearPortalFrames() { portalVolume.clear(); portalKeyboard.clear(); }
    private void detachPortal() { portalVolume.detach(); portalKeyboard.detach(); }

    private net.kckern.daylight.core.spi.InputLock inputLock() {
        return core.services().find(net.kckern.daylight.core.spi.InputLock.class);
    }

    private boolean portalEnabled(boolean keyboard) {
        return "portal".equals(core.deviceId()) && core.capabilityNames().contains(keyboard ? "hid-input" : "volume-keys")
                && bool(keyboard ? "hid.enabled" : "volumeKeys.enabled");
    }

    java.util.function.Consumer<JSONObject> keyboardTarget() {
        if (!portalEnabled(true) || !visibleKioskPage()) return null;
        Object destination = portalKeyboard.target(inputLock(), tokens);
        return destination == null ? null : frame -> portalInput(true, frame, destination);
    }

    void portalVolume(JSONObject frame) {
        portalInput(false, frame, portalVolume.target(inputLock(), tokens));
    }

    private void portalInput(boolean keyboard, JSONObject frame, Object destination) {
        PortalPageInput page = keyboard ? portalKeyboard : portalVolume;
        if (!portalEnabled(keyboard) || !visibleKioskPage()) return;
        if (page.offer(destination, frame, inputLock(), tokens)) {
            final String event = keyboard ? "daylight:portalkeyboardready" : "daylight:portalvolumeready";
            ui.post(() -> {
                if (web != null && visibleKioskPage())
                    web.evaluateJavascript("window.dispatchEvent(new Event('" + event + "'))", null);
            });
        }
    }

    private PianoPage pianoPage;
    private volatile boolean midiStopped;
    private final PianoRepair pianoRepair = new PianoRepair();

    private synchronized void detachPiano() {
        if (pianoPage != null) core.notes().unsubscribe(pianoPage);
        pianoPage = null;
    }

    private synchronized String pianoCall(String token, String method, String arg) throws Exception {
        net.kckern.daylight.core.spi.PianoOutput out = core.services().find(net.kckern.daylight.core.spi.PianoOutput.class);
        if (midiStopped || !"piano".equals(core.deviceId()) || out == null || !origins.allows(mainUrl)
                || !BridgeDispatcher.pianoPath(mainUrl) || !tokens.topFrame(token)) return "";
        if ("pianoSubscribe".equals(method)) {
            detachPiano();
            pianoPage = new PianoPage(token, () -> ui.post(() -> {
                if (web != null && !errorPage && origins.allows(mainUrl) && BridgeDispatcher.pianoPath(mainUrl))
                    web.evaluateJavascript("window.dispatchEvent(new Event('daylight:midiready'))", null);
            }));
            core.notes().subscribe(pianoPage);
            return "true";
        }
        if (pianoPage == null || !token.equals(pianoPage.token)) return "";
        switch (method) {
            case "pianoRead": return pianoPage.drain();
            case "pianoUnsubscribe": detachPiano(); return "true";
            case "pianoStatus":
                JSONObject status = core.status().collect(net.kckern.daylight.core.StatusBoard.Surface.FRAME, new JSONObject());
                JSONObject result = new JSONObject().put("type", "status");
                for (String key : new String[]{"speakerOk", "outVerified", "midiInOpen", "midiWriteOpen"})
                    if (status.opt(key) instanceof Boolean) result.put(key, status.getBoolean(key));
                return result.toString();
            case "pianoRepair": return String.valueOf(pianoRepair.start(token, out, bridgeExec));
            case "pianoRepairResult": return pianoRepair.result(token);
            case "pianoSend": return String.valueOf(PianoPage.send(out, arg));
            default: return "";
        }
    }

    private String shim() {
        return BridgeScript.shim(sessionKey, core.payloadVersion(), core.deviceId(), WebViewHostCapability.pinMediaOffered(core));
    }

    private void destroyWebView() {
        clearCallRequests();
        documentCommitted = false;
        detachPortal();
        detachPiano();
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
        // A page-initiated address that keeps failing is not retried for ever: the kiosk
        // goes back to its start page. Origin only in the log; a path can carry a token.
        if (RetryPolicy.abandonForStart(loads.failures(), intendedUrl, startUrl())) {
            note("giving up on a page that failed " + loads.failures() + " times in a row (origin "
                    + NavigationPolicy.originForLog(intendedUrl) + "); loading the start page");
            trust.loadedByApp();
            load(startUrl());
            return;
        }
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
            if (view != web) return;
            documentCommitted = false;
            clearCallRequests();
            committingUrl = url;
            detachPiano();
            detachPortal();
            mainUrl = url;
            if (isLocalPage(url)) return;
            // The second line of the navigation rule: a main-frame load that got past
            // shouldOverrideUrlLoading (a redirect, a form post) is stopped here.
            if (!navigation.allows(url)) {
                note("stopped a main-frame load outside the allowed origins: " + NavigationPolicy.originForLog(url));
                view.stopLoading();
                String start = startUrl();
                if (bounces.stoppedAndGiveUp(System.currentTimeMillis())) {
                    // The start page itself keeps leading away. Reloading it at once would
                    // loop at the speed of the network. The load is settled as failed, so
                    // the local error page shows and the usual retry, with its doubling
                    // delay, is all that follows.
                    String why = "this page leads to " + NavigationPolicy.originForLog(url)
                            + ", which is not in webview.allowedOrigins";
                    note("the start page keeps leading outside the allowed origins; slowing down. "
                            + "Add the origin to webview.allowedOrigins if it is meant to be reached");
                    cancelDeadline();
                    intendedUrl = start;
                    LoadTracker.Result failed = loads.stopped(why, System.currentTimeMillis());
                    if (failed != null) afterSettle(failed);
                    else showErrorPage(start, why, -1);
                    return;
                }
                if (!start.isEmpty() && navigation.allows(start)) { trust.loadedByApp(); load(start); }
                return;
            }
            mainUrl = url;
            // A new document: the tokens of the ones before it stop working.
            tokens.navigated();
            // A navigation the page started itself is tracked too, so its failure gets the same recovery.
            if (loads.state() != LoadTracker.State.LOADING) {
                intendedUrl = url;
                errorPage = false;
                armDeadline(loads.begin(url, System.currentTimeMillis()));
            }
            loads.started(url);
        }

        @Override public void onPageCommitVisible(WebView view, String url) {
            if (view == web && url != null && url.equals(committingUrl) && origins.allows(url) && origins.allows(mainUrl))
                documentCommitted = true;
        }

        @Override public void onPageFinished(WebView view, String url) {
            if (view != web || isLocalPage(url)) return;
            // Counted only for the load whose start was seen: the finish of a load that
            // was superseded must not settle the one that replaced it.
            LoadTracker.Result r = loads.finished(System.currentTimeMillis(), url);
            if (r == null) return;
            if (r.ok) bounces.settled();
            cancelDeadline();
            afterSettle(r);
        }

        @Override public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
            // Also fires for history.pushState, which onPageStarted does not see.
            if (view == web) {
                mainUrl = url;
                if (!origins.allows(url) || !BridgeDispatcher.pianoPath(url)) detachPiano();
            }
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
            if (!http) {
                note("blocked a non-http navigation: " + scheme);
                return true;   // true = do not load. intent:, market:, tel: never leave the page this way.
            }
            // The main frame goes only to the start origin and the origins this device
            // adds. Frames inside the page are not held to this: it embeds media from elsewhere.
            if (request.isForMainFrame() && !navigation.allows(String.valueOf(request.getUrl()))) {
                note("refused a main-frame navigation outside the allowed origins: "
                        + NavigationPolicy.originForLog(String.valueOf(request.getUrl())));
                return true;
            }
            // A tap on a link inside the page is the user asking; a script's redirect is not.
            if (request.isForMainFrame()) trust.pageNavigated(request.hasGesture());
            return false;
        }

        @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            if (view != web) return true;   // a WebView already replaced
            long now = System.currentTimeMillis();
            rendererAlive = false;
            loads.rendererGone(now);
            cancelDeadline();
            cancelRetry();
            boolean requested = resetRequested;
            resetRequested = false;
            // A reset that was asked for is not a crash. A crash is counted, and one that
            // follows the last within the window is slowed down: a page that kills its
            // renderer each time it loads must not be reloaded at once for ever.
            RendererLossPolicy.Action action = requested ? new RendererLossPolicy.Action(0, 0, false)
                    : rendererLosses.lost(now, integer("recovery.reloadOnPageFailureSec"), integer("recovery.maxRetrySec"));
            note("renderer gone, crashed=" + detail.didCrash() + (requested ? " (reset requested)"
                    : " lossesInARow=" + action.count + " reloadInMs=" + action.delayMs));
            // Every WebView in the process may share that renderer; the web overlay is rebuilt too.
            if (overlayWeb != null) { removeOverlayWeb(); renderWeb(); }
            if (activity == null) return true;
            final String url = reloadTarget();
            destroyWebView();
            buildWebView();
            if (url.isEmpty()) {
                showNotConfigured();
            } else if (action.delayMs <= 0) {
                load(url);
            } else {
                intendedUrl = url;
                showErrorPage(url, "the page's renderer was lost " + action.count + " times in a row", action.delayMs);
                retry = () -> { if (web != null && !intendedUrl.isEmpty()) load(intendedUrl); };
                ui.postDelayed(retry, action.delayMs);
            }
            return true;                     // handled: do not kill the app
        }
    }

    private static final int CALL_PERMISSIONS = 9342;
    private final List<String> requestedCallPermissions = new ArrayList<>();
    private final List<PermissionRequest> callRequests = new ArrayList<>();

    private boolean callPage(PermissionRequest request) {
        if (activity == null || web == null || errorPage || !origins.allows(mainUrl)) return false;
        String requester = String.valueOf(request.getOrigin());
        boolean external = trust.openedFromOutside();
        if (CallCapturePolicy.allows(startUrl(), web.getUrl(), requester, external)) return true;
        String[] resources = request.getResources();
        return resources.length == 1 && PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resources[0])
                && CallCapturePolicy.allowsBarcode(startUrl(), web.getUrl(), requester, external);
    }

    private static String callPermission(String resource) {
        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) return android.Manifest.permission.RECORD_AUDIO;
        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) return android.Manifest.permission.CAMERA;
        return null;
    }

    private void clearCallRequests() {
        List<PermissionRequest> canceled = new ArrayList<>(callRequests);
        callRequests.clear();
        for (PermissionRequest request : canceled) request.deny();
    }

    private void handleCallRequest(PermissionRequest request) {
        if (!callPage(request)) { request.deny(); return; }
        List<String> missing = new ArrayList<>();
        for (String resource : request.getResources()) {
            String permission = callPermission(resource);
            if (permission != null && !holds(permission)) missing.add(permission);
        }
        if (missing.isEmpty()) { finishCallRequest(request); return; }
        callRequests.add(request);
        if (!requestedCallPermissions.isEmpty()) return;
        requestedCallPermissions.addAll(missing);
        activity.requestPermissions(missing.toArray(new String[0]), CALL_PERMISSIONS);
    }

    private void finishCallRequest(PermissionRequest request) {
        List<String> allowed = new ArrayList<>();
        if (callPage(request)) {
            for (String resource : request.getResources()) {
                String permission = callPermission(resource);
                if (permission != null && holds(permission)) allowed.add(resource);
            }
        }
        if (allowed.isEmpty()) request.deny(); else request.grant(allowed.toArray(new String[0]));
    }

    @Override public void onHostPermissionsResult(int code) {
        if (code != CALL_PERMISSIONS || requestedCallPermissions.isEmpty()) return;
        List<String> attempted = new ArrayList<>(requestedCallPermissions);
        requestedCallPermissions.clear();
        List<PermissionRequest> requests = new ArrayList<>(callRequests);
        callRequests.clear();
        boolean denied = false;
        for (PermissionRequest request : requests) {
            boolean needsAnotherPrompt = false;
            boolean requestDenied = false;
            if (callPage(request)) {
                for (String resource : request.getResources()) {
                    String permission = callPermission(resource);
                    if (permission != null && !holds(permission)) {
                        if (attempted.contains(permission)) requestDenied = true;
                        else needsAnotherPrompt = true;
                    }
                }
            }
            denied |= requestDenied;
            if (needsAnotherPrompt && !requestDenied) handleCallRequest(request); else finishCallRequest(request);
        }
        if (denied && activity != null) {
            new AlertDialog.Builder(activity).setTitle("Allow camera or microphone")
                    .setMessage("Open Permissions in Daylight’s app settings, switch on the camera or microphone, then come back. The barcode scanner starts again by itself.")
                    .setNegativeButton("Close", null)
                    .setPositiveButton("App settings", (dialog, which) -> activity.startActivity(new Intent(
                            android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                            android.net.Uri.fromParts("package", app.getPackageName(), null)))).show();
        }
    }

    private final class ChromeClient extends WebChromeClient {
        private final WebView owner;

        ChromeClient(WebView owner) { this.owner = owner; }

        @Override public void onPermissionRequestCanceled(PermissionRequest request) {
            callRequests.remove(request);
        }

        @Override public void onPermissionRequest(PermissionRequest request) {
            if (owner != web) { request.deny(); return; }
            if (bool("webview.callPermissions")) {
                if (resumed) handleCallRequest(request); else request.deny();
                return;
            }
            if (!origins.allows(String.valueOf(request.getOrigin()))) {
                note("denied a media request from " + request.getOrigin());
                request.deny();
                return;
            }
            // A document a link from outside the app opened (one without the install key)
            // gets neither, whatever the settings say: see DocumentTrust.
            boolean outside = trust.openedFromOutside();
            List<String> grant = new ArrayList<>();
            for (String res : request.getResources()) {
                if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res) && DocumentTrust.mayCapture(true,
                        bool("webview.allowMic"), holds(android.Manifest.permission.RECORD_AUDIO), outside)) grant.add(res);
                if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res) && DocumentTrust.mayCapture(true,
                        bool("webview.allowCamera"), holds(android.Manifest.permission.CAMERA), outside)) grant.add(res);
            }
            if (grant.isEmpty()) {
                note("media request not granted: " + java.util.Arrays.toString(request.getResources())
                        + (outside ? " (the page was opened by a link without the install key)" : ""));
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
        private final BridgeDispatcher owner;
        NativeBridge(BridgeDispatcher owner) { this.owner = owner; }

        /**
         * The shim's first call: its key for a token that belongs to the calling document,
         * and whether that document is the top frame ("top") or a frame.
         */
        @JavascriptInterface public String open(String key, String frame) {
            BridgeDispatcher d = dispatcher;
            return d != owner ? "" : owner.open(key, frame);
        }

        @JavascriptInterface public String call(String token, String method, String arg) {
            BridgeDispatcher d = dispatcher;
            return d != owner ? "" : owner.call(token, method, arg);
        }
    }

    /** What an accepted bridge call does. Reads answer inline; actions run on the bridge executor. */
    private final class PageActions implements BridgeDispatcher.Actions {
        @Override public String piano(String token, String method, String arg) throws Exception {
            if (PianoToolCalls.supports(method)) {
                if (!"piano".equals(core.deviceId()) || !visibleKioskPage() || !tokens.currentTopFrame(token)
                        || !BridgeDispatcher.pianoPath(mainUrl)) return "";
                return PianoToolCalls.call(core.services(), method, arg);
            }
            return pianoCall(token, method, arg);
        }
        @Override public String portal(String token, String method) {
            boolean keyboard = method.startsWith("portalKeyboard");
            PortalPageInput page = keyboard ? portalKeyboard : portalVolume;
            if (!"portal".equals(core.deviceId()) || !trustedKioskPage() || !tokens.currentTopFrame(token)) return "";
            if (method.endsWith("Unsubscribe")) { page.detach(token); return "true"; }
            if (!portalEnabled(keyboard)) return "";
            if (method.endsWith("Subscribe")) { page.attach(token); return "true"; }
            return visibleKioskPage() ? page.read(token, inputLock()) : "";
        }

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

        @Override public boolean canPinMedia() {
            MediaPinner pinner = core.services().find(MediaPinner.class);
            return pinner != null && pinner.canPin();
        }

        /**
         * On the WebView's bridge thread: the launcher's pin dialog is asked for here and
         * the answer is whether it was. Nothing about the request is logged but the
         * outcome, which media-service notes.
         */
        @Override public JSONObject pinMedia(String contentId, String label) {
            MediaPinner pinner = core.services().find(MediaPinner.class);
            return pinner == null ? null : pinner.pin(contentId, label);
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

    /** webview.showWhenLocked changed: tell the Activity, when there is one. Any thread. */
    void applyLockScreen() {
        ui.post(() -> { if (host != null) LockScreenRule.apply(host, bool("webview.showWhenLocked")); });
    }

    /** Called from the capability's stop(), on any thread. Does not wait for the main thread. */
    void shutdown() {
        detachPortal();
        synchronized (this) { midiStopped = true; detachPiano(); pianoRepair.stop(); }
        bridgeExec.shutdown();
        ui.post(() -> {
            overlayText = "";
            overlayUrl = "";
            renderText();
            renderWeb();
        });
        // Never attach(null): this stop() may land after the next payload's session has
        // attached, and an unconditional detach would take that one's window away. The
        // host compares on the main thread and detaches only this session. The Activity
        // is asked for through the shell and not read from `host`, which only the main
        // thread writes.
        Object published = core.components().get(KioskHost.COMPONENT);
        KioskHost h = published instanceof KioskHost ? (KioskHost) published : host;
        if (h != null) try { h.detach(this); } catch (Throwable t) { note("detach failed: " + t); }
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

    /**
     * What may be loaded into the main frame on request: an http or https URL on the
     * start origin or an origin this device adds. The same rule the page's own
     * navigations are held to, asked before anything is started.
     */
    private void requireHttp(String url) {
        if (url == null || OriginPolicy.originOf(url) == null) throw new IllegalArgumentException("url must be an http or https URL");
        NavigationPolicy allowed = NavigationPolicy.of(startUrl(), str("webview.allowedOrigins"), foreign("links.origins"));
        if (!allowed.allows(url)) {
            throw new IllegalArgumentException("origin_not_allowed: the kiosk loads only its start URL's origin and webview.allowedOrigins");
        }
    }

    /** True when a kiosk Activity is attached, starting one and waiting briefly when it is not. */
    private boolean ensureAttached() {
        if (attached()) return true;
        return bringToFront() && MainThread.waitFor(this::attached, 5000);
    }

    private final PendingOpen pendingOpen = new PendingOpen();

    /**
     * PageOpener. Never starts the Activity: from the background Android would refuse,
     * and the caller (the link activity, which is in front) brings the window forward.
     */
    @Override public String open(final String url) { return open(url, false); }

    /** The same, for a link that did not carry the install key: the document it opens gets no capture. */
    @Override public String openFromOutside(final String url) { return open(url, true); }

    private String open(final String url, final boolean fromOutside) {
        requireHttp(url);
        boolean attached = attached();
        pendingOpen.set(url, loads.newLoadId(), System.currentTimeMillis(), fromOutside);
        ui.post(() -> {
            if (web != null && (!"history".equals(backMode) || resumed)) openPendingLink(true);
        });
        return attached ? "loading" : "pending";
    }

    private boolean openPendingLink(boolean replacePage) {
        if (web == null) return false;
        PendingOpen.Request request = pendingOpen.takeRequest(System.currentTimeMillis());
        if (request == null) return false;
        if (replacePage && "history".equals(backMode)) {
            destroyWebView();
            buildWebView();
        }
        shortcutLaunch = request.shortcut ? request.url : null;
        if (request.outside) trust.loadedFromOutside(); else trust.loadedByApp();
        load(request.url, request.loadId);
        return true;
    }

    LoadTracker.Result loadAndWait(final String url) throws Exception {
        requireHttp(url);
        final String loadId = loads.newLoadId();
        if (!ensureAttached()) return new LoadTracker.Result(loadId, url, false, "no_kiosk_activity", System.currentTimeMillis(), 0);
        CompletableFuture<LoadTracker.Result> f = MainThread.call(() -> {
            if (web == null) return null;
            shortcutLaunch = null;
            trust.loadedByApp();     // a control route: the caller presented the device token
            return load(url, loadId);
        }, 5000);
        if (f == null) return new LoadTracker.Result(loadId, url, false, "no_kiosk_activity", System.currentTimeMillis(), 0);
        return f.get(integer("webview.loadTimeoutSec") + 5L, TimeUnit.SECONDS);
    }

    /**
     * The wait:false mode. Starts the load and returns at once with its id; the outcome
     * is read from lastLoad in GET /kiosk/status. With no kiosk Activity the load is
     * queued (the latest one wins) and the Activity is started; it loads when that attaches.
     */
    String loadAccepted(final String url) {
        requireHttp(url);
        final String loadId = loads.newLoadId();
        if (!attached()) {
            // Queued for the Activity that attaches next, in place of the start page. One
            // slot: a later request replaces it, so nothing piles up while no window is up.
            pendingOpen.set(url, loadId, System.currentTimeMillis());
            bringToFront();
            return loadId;
        }
        ui.post(() -> {
            if (web != null) { shortcutLaunch = null; trust.loadedByApp(); load(url, loadId); }
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
                    resetRequested = true;
                    ended = terminate(WebViewCompat.getWebViewRenderProcess(web));   // then onRenderProcessGone rebuilds
                }
            } catch (Throwable ignored) { }
            if (!ended) resetRequested = false;
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
        // The page bridge: available, unavailable (with the reason), or unknown before a WebView exists.
        BridgeAvailability b = bridge;
        o.put("bridge", b == null ? "unknown" : b.state())
                .put("bridgeReason", b == null || b.reason == null ? JSONObject.NULL : b.reason)
                // Renderer crashes in a row (0 once the renderer has stayed up five minutes), and all since start.
                .put("rendererLosses", rendererLosses.consecutive(System.currentTimeMillis()))
                .put("rendererLossesTotal", rendererLosses.total())
                // pinMedia requests refused for coming within five seconds of the document's last.
                .put("pinRequestsRefused", pinGate.refused());
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
