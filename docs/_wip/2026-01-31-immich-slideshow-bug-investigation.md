# Immich Slideshow Bug Investigation

**Date:** 2026-01-31  
**Issue:** Images in Immich person slideshows (composed presentations) stuck in loading spinner

## Symptoms

- Test: `tests/live/flow/content/immich-slideshow-plex-audio.runtime.test.mjs`
- Browser shows loading spinner indefinitely
- No images load in ImageCarousel component
- Network logs show only thumbnail requests, no full-resolution image requests

## Root Cause Analysis

### Expected Flow

1. ComposePresentationUseCase calls `adapter.getList('person:xyz')` 
2. ImmichAdapter.getList returns ListableItem[] with properties:
   - `thumbnail`: `/api/v1/proxy/immich/assets/{id}/thumbnail`
   - `imageUrl`: `/api/v1/proxy/immich/assets/{id}/original`
3. ComposePresentationUseCase maps items to visual track:
   ```javascript
   url: visualType === 'image' 
     ? (item.imageUrl || item.mediaUrl || item.thumbnail)
     : (item.mediaUrl || item.thumbnail)
   ```
4. Compose API returns visual track with full-resolution URLs
5. Frontend ImageCarousel preloads and displays images

### Actual Behavior

- Compose API returns **thumbnail URLs** in visual track items
- ImageCarousel tries to preload thumbnails (which work)
- But thumbnails are being loaded as full images, causing issues
- Network logs confirm: only `/thumbnail` requests, never `/original`

### Investigation Results

1. **ImmichAdapter.#toListableItem()** correctly creates ListableItem with:
   ```javascript
   thumbnail: this.#thumbnailUrl(asset.id),  // ✓ Set correctly
   imageUrl: this.#originalUrl(asset.id),     // ✓ Set correctly
   ```

2. **ListableItem constructor** correctly assigns:
   ```javascript
   this.imageUrl = props.imageUrl ?? null;   // ✓ In constructor
   ```

3. **ComposePresentationUseCase** correctly checks:
   ```javascript
   url: item.imageUrl || item.mediaUrl || item.thumbnail  // ✓ Checks imageUrl first
   ```

4. **BUT**: Test output shows thumbnail URLs are returned by compose API:
   ```
   First item URL: /api/v1/proxy/immich/assets/.../thumbnail
   ```

### Hypothesis

The `imageUrl` property is being lost somewhere between:
- ImmichAdapter creating the ListableItem
- ComposePresentationUseCase receiving the items
- The compose API response

Possible causes:
1. **ListableItem.toJSON()** not preserving imageUrl? 
   - Uses `{...this}` spread which should include all properties
2. **Item base class** not including imageUrl in serialization?
   - Base class only explicitly sets: thumbnail, description, metadata
   - **Does NOT set imageUrl!**
3. **JSON serialization** dropping the property?

### The Actual Bug

Looking at `/backend/src/2_domains/content/entities/Item.mjs`:

```javascript
constructor(props) {
  // ...
  this.thumbnail = props.thumbnail ?? null;
  // imageUrl is NOT assigned here!
}
```

The `Item` base class constructor does NOT assign `imageUrl` from props!

When `ListableItem extends Item` and calls `super(props)`, the base constructor runs first and doesn't set `imageUrl`. Then `ListableItem` constructor tries to set it:

```javascript
constructor(props) {
  super(props);  // Base class doesn't set imageUrl
  // ...
  this.imageUrl = props.imageUrl ?? null;  // THIS should work
}
```

**Wait** - this SHOULD work because `ListableItem` sets it after calling super().

Let me reconsider... Maybe the issue is in how items are serialized/passed through the system?

## Next Steps

1. Add `imageUrl` support to Item base class constructor
2. Verify ListableItem.toJSON() includes imageUrl
3. Test end-to-end flow
4. Update ImageCarousel to handle both thumbnail (for preview) and imageUrl (for display)

## Solution

Add imageUrl to Item base class constructor to ensure it's always preserved:

```javascript
// In Item constructor
this.imageUrl = props.imageUrl ?? null;
```

This ensures any capability class that needs imageUrl will have it preserved through serialization.
