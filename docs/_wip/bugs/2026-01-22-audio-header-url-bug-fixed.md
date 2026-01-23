# Bug Report: Audio Player Shows File URL Instead of Artist - Album

**Date Discovered:** 2026-01-22  
**Date Fixed:** 2026-01-22  
**Severity:** Medium  
**Status:** Fixed  
**Component:** Frontend - AudioPlayer  

---

## Summary

The `.audio-header` element in the AudioPlayer component was displaying the file URL path instead of the artist and album information on localhost, while production displayed it correctly.

---

## Steps to Reproduce

1. Navigate to http://localhost:3111/tv?play=154382
2. Observe the audio-header text

**Expected (Production):**  
`"The Tabernacle Choir at Temple Square - Let Us All Press On"`

**Actual (Localhost - Before Fix):**  
`"/api/v1/proxy/plex/library/parts/158577/1615703157/file.mp3?X-Plex-Client-Identifier=..."`

---

## Root Cause

In [AudioPlayer.jsx line 95](../../frontend/src/modules/Player/components/AudioPlayer.jsx), the header was constructed with this logic:

```jsx
const header = !!artist && !!album 
  ? `${artist} - ${album}` 
  : !!artist ? artist 
  : !!album ? album 
  : media_url;  // ← Fell back to ugly URL!
```

The issue was that:

1. The component destructured `artist` and `album` from the top level of the `media` prop
2. But Plex track metadata stores these fields in `media.metadata.artist` and `media.metadata.album`
3. When `artist` and `album` were undefined, it fell back to showing `media_url`

### Media Object Structure

```json
{
  "title": "Press Forward, Saints",
  "show": "The Tabernacle Choir at Temple Square",
  "metadata": {
    "artist": "The Tabernacle Choir at Temple Square",  // ← Not at top level!
    "album": "Let Us All Press On",                     // ← Not at top level!
    "grandparentTitle": "The Tabernacle Choir at Temple Square"
  }
}
```

---

## Fix Applied

**File:** `frontend/src/modules/Player/components/AudioPlayer.jsx`

### Changes Made

1. **Added fallback chain for artist/album extraction:**
   ```jsx
   const effectiveArtist = artist 
     || media?.metadata?.artist 
     || media?.grandparentTitle 
     || media?.metadata?.grandparentTitle 
     || null;
   
   const effectiveAlbum = album 
     || media?.metadata?.album 
     || media?.parentTitle 
     || media?.metadata?.parentTitle 
     || null;
   ```

2. **Updated header logic to use effective values and better fallback:**
   ```jsx
   const header = !!effectiveArtist && !!effectiveAlbum 
     ? `${effectiveArtist} - ${effectiveAlbum}` 
     : !!effectiveArtist ? effectiveArtist 
     : !!effectiveAlbum ? effectiveAlbum 
     : title || 'Audio Track';  // ← Better fallback!
   ```

### Key Improvements

- ✅ Checks multiple locations for artist/album data
- ✅ Falls back to `title` instead of `media_url`
- ✅ Handles Plex metadata structure variations
- ✅ Maintains backward compatibility

---

## Testing

### Test Script
`tests/runtime/tv-app/audio-header-investigation.mjs`

### Results

| Environment | Before Fix | After Fix |
|-------------|------------|-----------|
| **Localhost** | `/api/v1/proxy/plex/library/parts/...` ❌ | `The Tabernacle Choir at Temple Square - Let Us All Press On` ✅ |
| **Production** | `The Tabernacle Choir at Temple Square - Let Us All Press On` ✅ | `The Tabernacle Choir at Temple Square - Let Us All Press On` ✅ |

---

## Related Issues

This fix also improves robustness for:
- Tracks where metadata is structured differently
- Items where `artist`/`album` might be missing
- Better user experience when metadata is incomplete

---

## References

- Test output: `/tmp/audio-header-test.log`
- Media object inspector: `tests/runtime/tv-app/debug-media-object.mjs`
- Production test: `tests/runtime/tv-app/tv-prod-test.mjs`
