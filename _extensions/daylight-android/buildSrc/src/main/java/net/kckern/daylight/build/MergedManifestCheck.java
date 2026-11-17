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
 * The rule checked here: installing a build must change no device's home candidate
 * set. A HOME filter exists only on an activity-alias that is declared disabled, whose
 * target is the kiosk Activity and is declared before it.
 */
public final class MergedManifestCheck {
    private static final String ANDROID = "http://schemas.android.com/apk/res/android";
    private static final String HOME = "android.intent.category.HOME";

    private MergedManifestCheck() { }

    /** Every way the merged manifest breaks the rules, as messages. Empty when it is sound. */
    public static List<String> failures(String mergedManifestXml, DeviceSpec d) {
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
        if (wantsAlias && homeFilters != 1) out.add("expected exactly one HOME filter (on the disabled alias), found " + homeFilters);
        if (!wantsAlias && homeFilters != 0) out.add("a build without lockdown must have no HOME filter, found " + homeFilters);
        return out;
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
