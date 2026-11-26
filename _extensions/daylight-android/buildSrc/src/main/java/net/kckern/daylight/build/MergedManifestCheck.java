package net.kckern.daylight.build;

import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import javax.xml.parsers.DocumentBuilderFactory;

/**
 * Checks a device's MERGED manifest, the one that goes into its APK, for the things a
 * generated fragment cannot promise by itself because other modules' manifests are
 * merged in after it.
 *
 * The rules checked here. Installing a build must change no device's home candidate
 * set: a HOME filter exists only on an activity-alias that is declared disabled, whose
 * target is the kiosk Activity and is declared before it. And in a build that lists
 * lockdown the kiosk Activity cannot be resized into split screen or picture-in-picture.
 */
public final class MergedManifestCheck {
    private static final String ANDROID = "http://schemas.android.com/apk/res/android";
    private static final String HOME = "android.intent.category.HOME";

    private MergedManifestCheck() { }

    /** Every way the merged manifest breaks the home-candidate rules, as messages. Empty when it is sound. */
    public static List<String> failures(String mergedManifestXml, DeviceSpec d) {
        return failures(mergedManifestXml, d, null, false);
    }

    /** As above, plus the exact list of a personal device and the backup rules of every device. */
    public static List<String> failures(String mergedManifestXml, DeviceSpec d, PersonalBuild.Expectation personal) {
        return failures(mergedManifestXml, d, personal, true);
    }

    /**
     * @param personal  the exact permissions and exported components of a device with
     *                  control.bind none (PersonalBuild.expectation); null for any other
     * @param appRules  also hold the application element to the backup rules
     */
    public static List<String> failures(String mergedManifestXml, DeviceSpec d, PersonalBuild.Expectation personal, boolean appRules) {
        List<String> out = new ArrayList<>();
        Document doc;
        try {
            DocumentBuilderFactory f = DocumentBuilderFactory.newInstance();
            f.setNamespaceAware(true);
            doc = f.newDocumentBuilder().parse(new ByteArrayInputStream(mergedManifestXml.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            out.add("the merged manifest is not readable XML: " + e.getMessage());
            return out;
        }
        boolean wantsAlias = d.capabilities.contains(DeviceManifestSource.KIOSK_CAPABILITY)
                && d.capabilities.contains(DeviceManifestSource.LOCKDOWN_CAPABILITY);
        int homeFilters = 0;
        NodeList categories = doc.getElementsByTagName("category");
        for (int i = 0; i < categories.getLength(); i++) {
            Element category = (Element) categories.item(i);
            if (!HOME.equals(category.getAttributeNS(ANDROID, "name"))) continue;
            homeFilters++;
            Node filter = category.getParentNode();
            Node owner = filter == null ? null : filter.getParentNode();
            if (!(owner instanceof Element) || !"activity-alias".equals(((Element) owner).getTagName())) {
                out.add("a HOME filter sits on <" + (owner == null ? "?" : owner.getNodeName()) + " "
                        + (owner instanceof Element ? ((Element) owner).getAttributeNS(ANDROID, "name") : "")
                        + ">: it may only be on the disabled alias, or installing adds a home candidate");
                continue;
            }
            Element alias = (Element) owner;
            String name = alias.getAttributeNS(ANDROID, "name");
            if (!DeviceManifestSource.HOME_ALIAS.equals(name)) out.add("the HOME filter is on an unexpected alias: " + name);
            if (!"false".equals(alias.getAttributeNS(ANDROID, "enabled"))) {
                out.add("the HOME alias " + name + " is not declared android:enabled=\"false\": installing would add a home candidate");
            }
            if (!DeviceManifestSource.KIOSK_ACTIVITY.equals(alias.getAttributeNS(ANDROID, "targetActivity"))) {
                out.add("the HOME alias does not target " + DeviceManifestSource.KIOSK_ACTIVITY);
            }
            if (!declaredBefore(doc, DeviceManifestSource.KIOSK_ACTIVITY, alias)) {
                out.add("the HOME alias is declared before its target activity: the APK would not install");
            }
        }
        if (wantsAlias) {
            Element kiosk = activity(doc, DeviceManifestSource.KIOSK_ACTIVITY);
            if (kiosk == null) {
                out.add("the kiosk activity is missing from the merged manifest");
            } else {
                for (String attribute : new String[] { "resizeableActivity", "supportsPictureInPicture" }) {
                    if (!"false".equals(kiosk.getAttributeNS(ANDROID, attribute))) {
                        out.add("the kiosk activity must declare android:" + attribute + "=\"false\" in a build that lists lockdown: "
                                + "beside another app in split screen it would count as in front");
                    }
                }
            }
        }
        if (wantsAlias && homeFilters != 1) out.add("expected exactly one HOME filter (on the disabled alias), found " + homeFilters);
        if (!wantsAlias && homeFilters != 0) out.add("a build without lockdown must have no HOME filter, found " + homeFilters);
        if (appRules) backupRules(doc, out);
        if (personal != null) personalRules(doc, personal, out);
        return out;
    }

    private static Element application(Document doc) {
        NodeList apps = doc.getElementsByTagName("application");
        return apps.getLength() == 0 ? null : (Element) apps.item(0);
    }

    /**
     * Nothing the app keeps is backed up or carried to another device: the link key, a
     * control token's settings and a queued recording stay on the device they were made on.
     */
    private static void backupRules(Document doc, List<String> out) {
        Element app = application(doc);
        if (app == null) { out.add("the merged manifest has no application element"); return; }
        if (!"false".equals(app.getAttributeNS(ANDROID, "allowBackup"))) out.add("the application must declare android:allowBackup=\"false\"");
        for (String attribute : new String[] { "dataExtractionRules", "fullBackupContent" }) {
            if (app.getAttributeNS(ANDROID, attribute).isEmpty()) {
                out.add("the application must declare android:" + attribute + " (rules that exclude everything from backup and device transfer)");
            }
        }
    }

    private static final String[] COMPONENTS = { "activity", "activity-alias", "service", "receiver", "provider" };
    /** Manifest attributes that put a window over the lock screen or wake the screen for it. */
    private static final String[] LOCK_SCREEN_ATTRIBUTES = { "showWhenLocked", "turnScreenOn", "showOnLockScreen" };
    /**
     * The only windows of a personal build allowed over the lock screen (showWhenLocked, not the
     * other two): the capture path a quick-settings tile starts without an unlock. They write into
     * a private queue and show nothing already saved; the link activity is the visible hop that
     * starts them. The same list as OVER_LOCK_ALLOWED in tools/verify-lib.mjs.
     */
    private static final java.util.Set<String> OVER_LOCK_ALLOWED = new java.util.HashSet<>(java.util.Arrays.asList(
            "net.kckern.daylight.cap.notifications.shell.LinkActivity",
            "net.kckern.daylight.cap.quickinput.shell.RecordActivity",
            "net.kckern.daylight.cap.quickinput.shell.MealCameraActivity",
            "net.kckern.daylight.cap.quickinput.shell.PhotoCaptureActivity"));

    /** The exact list of a device with control.bind none. */
    private static void personalRules(Document doc, PersonalBuild.Expectation want, List<String> out) {
        java.util.Set<String> permissions = new java.util.TreeSet<>();
        for (String tag : new String[] { "uses-permission", "uses-permission-sdk-23" }) {
            NodeList list = doc.getElementsByTagName(tag);
            for (int i = 0; i < list.getLength(); i++) permissions.add(((Element) list.item(i)).getAttributeNS(ANDROID, "name"));
        }
        for (String p : permissions) {
            if (!want.permissions.contains(p)) out.add("permission " + p + " is not on this device's list (the base set, its capabilities' and its device file's)");
        }
        for (String p : want.permissions) {
            if (!permissions.contains(p)) out.add("permission " + p + " is on this device's list and not in the merged manifest");
        }
        java.util.Set<String> exported = new java.util.TreeSet<>();
        for (String tag : COMPONENTS) {
            NodeList list = doc.getElementsByTagName(tag);
            for (int i = 0; i < list.getLength(); i++) {
                Element e = (Element) list.item(i);
                String flag = e.getAttributeNS(ANDROID, "exported");
                // Below target 31 a component with a filter that does not say is exported.
                boolean reachable = "true".equals(flag) || (flag.isEmpty() && e.getElementsByTagName("intent-filter").getLength() > 0);
                if (reachable) exported.add(e.getAttributeNS(ANDROID, "name"));
                if (!e.getAttributeNS(ANDROID, "lockTaskMode").isEmpty()) {
                    out.add(e.getAttributeNS(ANDROID, "name") + " declares android:lockTaskMode: a personal device is never put in lock task");
                }
                // The site, a recording screen, a draft being typed: all of it is behind the lock.
                for (String attribute : LOCK_SCREEN_ATTRIBUTES) {
                    if ("showWhenLocked".equals(attribute) && OVER_LOCK_ALLOWED.contains(e.getAttributeNS(ANDROID, "name"))) continue;
                    if ("true".equals(e.getAttributeNS(ANDROID, attribute))) {
                        out.add(e.getAttributeNS(ANDROID, "name") + " declares android:" + attribute
                                + ": nothing of a personal device shows over the lock screen");
                    }
                }
            }
        }
        for (String name : exported) {
            if (!want.exported.contains(name)) out.add(name + " is exported and no listed capability declares it under 'exported:' in its capability.yml");
        }
        for (String name : want.exported) {
            if (!exported.contains(name)) out.add(name + " is declared as exported and is not exported in the merged manifest");
        }
        Element app = application(doc);
        if (app == null || !"false".equals(app.getAttributeNS(ANDROID, "usesCleartextTraffic"))) {
            out.add("the application must declare android:usesCleartextTraffic=\"false\" on a device with control.bind none");
        }
        NodeList categories = doc.getElementsByTagName("category");
        for (int i = 0; i < categories.getLength(); i++) {
            if ("android.intent.category.LEANBACK_LAUNCHER".equals(((Element) categories.item(i)).getAttributeNS(ANDROID, "name"))) {
                out.add("a LEANBACK_LAUNCHER category is in the merged manifest: a personal device is not offered to a TV launcher");
            }
        }
    }

    private static Element activity(Document doc, String name) {
        NodeList list = doc.getElementsByTagName("activity");
        for (int i = 0; i < list.getLength(); i++) {
            Element e = (Element) list.item(i);
            if (name.equals(e.getAttributeNS(ANDROID, "name"))) return e;
        }
        return null;
    }

    /** True when an activity of that name is a sibling that comes before {@code alias}. */
    private static boolean declaredBefore(Document doc, String activityName, Element alias) {
        for (Node n = alias.getPreviousSibling(); n != null; n = n.getPreviousSibling()) {
            if (n instanceof Element && "activity".equals(((Element) n).getTagName())
                    && activityName.equals(((Element) n).getAttributeNS(ANDROID, "name"))) return true;
        }
        return false;
    }
}
