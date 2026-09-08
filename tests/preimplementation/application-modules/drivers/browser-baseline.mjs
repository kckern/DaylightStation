/** Baseline browser entrypoints for the selectable preparation browser pack. */
const Gratitude = (await import('../../../../frontend/src/modules/AppContainer/Apps/Gratitude/Gratitude.jsx')).default;
const FamilySelector = (await import('../../../../frontend/src/modules/AppContainer/Apps/FamilySelector/FamilySelector.jsx')).default;
const GratitudeConfig = (await import('../../../../frontend/src/modules/Admin/Apps/GratitudeConfig.jsx')).default;
const { dispatchPortalHidMessage } = await import('../../../../frontend/src/screen-framework/usePortalHidKeyboard.js');
const { usePortalKeys } = await import('../../../../frontend/src/screen-framework/usePortalKeys.js');
const { usePianoBridgeNotes } = await import('../../../../frontend/src/modules/Piano/PianoKiosk/usePianoBridgeNotes.js');
const { ScreenVolumeContext } = await import('../../../../frontend/src/lib/volume/ScreenVolumeContext.js');
const { resolveParamOptions, getApp } = await import('../../../../frontend/src/lib/appRegistry.js');

export const implementation = { Gratitude, FamilySelector, GratitudeConfig, dispatchPortalHidMessage, usePortalKeys, usePianoBridgeNotes, ScreenVolumeContext, resolveParamOptions, getApp };
