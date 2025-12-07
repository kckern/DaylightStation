#Description
Scope frontend/src/modules/Fitness/FitnessSidebar/TouchVolumeButtons.jsx 
Works fine for setting volume.  However, if the video or audio reloads due to #useMediaResiliance, or moves to the next track, the volume resets to default. Volume should persist across media reloads and track changes.  Local storage or context can be used to store the volume level.  If there is already a volume set for a sibling track in the same show, season, or album or playlist, that volume should be used as the default for the new/next track, even if the user has not explicitly set volume for that track yet.  No need to save to backend, but the local storage or context should persist across page reloads and never expire or clear unless the user explicitly resets it via developer tools or similar, but nothing the ux should allow them to reset or clear it.


## Architecture Suggestions