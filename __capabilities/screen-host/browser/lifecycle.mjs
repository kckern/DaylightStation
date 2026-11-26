// The full-bleed frame's styles (ad-hoc screen), loaded with the helpers that apply it.
import "./fullbleed.css";
/** Explicit lifecycle surface; implementation remains owner-private. */
export { PortalKeysBridge } from "./PortalKeysBridge.jsx";
export { useInitialActionGate } from "./hooks/useInitialActionGate.js";
export { useFleetDeviceIdentity } from "./hooks/useFleetDeviceIdentity.js";
export { ActionLoadingShell } from "./ActionLoadingShell.jsx";
export { layoutOwnsRouting } from "./layoutOwnsRouting.js";
export { BROWSE_NAV_TYPES } from "./screenActivity.js";
export { resolveScreenDevice, screenName, startScreenAnnounce, BROWSER_SCREEN_ID, routeScreenId, screenFrame, lockPageScroll, ADHOC_SCREEN_ID } from "./identity/adhocScreen.js";
