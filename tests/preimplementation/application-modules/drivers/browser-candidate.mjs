/** Candidate owner public browser entrypoints for the selectable preparation browser pack. */
const Gratitude = (await import('../../../../modules/gratitude/browser/public.mjs')).default;
const FamilySelector = (await import('../../../../capabilities/household-identity/browser/public.mjs')).default;
const GratitudeConfig = (await import('../../../../modules/gratitude/browser/admin.mjs')).default;
const { dispatchPortalHidMessage } = await import('../../../../capabilities/screen-host/browser/usePortalHidKeyboard.js');
const { usePortalKeys } = await import('../../../../capabilities/screen-host/browser/usePortalKeys.js');
const { usePianoBridgeNotes } = await import('../../../../modules/piano/browser/PianoKiosk/usePianoBridgeNotes.js');
const { ScreenVolumeContext } = await import('../../../../frontend/src/lib/volume/ScreenVolumeContext.js');
const { resolveParamOptions, getApp } = await import('../../../../frontend/src/lib/appRegistry.js');

export const implementation = { Gratitude, FamilySelector, GratitudeConfig, dispatchPortalHidMessage, usePortalKeys, usePianoBridgeNotes, ScreenVolumeContext, resolveParamOptions, getApp };
