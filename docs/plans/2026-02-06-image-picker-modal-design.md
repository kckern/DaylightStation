# Image Picker Modal Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to set, change, or remove override thumbnails for list items via a visual picker modal, triggered from the row icon or the item editor.

**Architecture:** A standalone `ImagePickerModal` component used from two places (col-icon click and item editor). One new backend endpoint lists existing images. Upload and URL-drop reuse the existing upload endpoint.

**Tech Stack:** Mantine Modal, Dropzone, SegmentedControl; Express backend endpoint; existing admin images router.

---

## Components

### ImagePickerModal

**File:** `frontend/src/modules/Admin/ContentLists/ImagePickerModal.jsx`

**Props:**
| Prop | Type | Description |
|------|------|-------------|
| `opened` | boolean | Controls modal visibility |
| `onClose` | () => void | Close callback |
| `currentImage` | string \| null | Item's `image` override path |
| `inheritedImage` | string \| null | Thumbnail from resolved content input |
| `onSave` | (path: string \| null) => void | Called immediately on pick/remove |
| `inUseImages` | Set\<string\> | Image paths assigned to items in this list |

**Layout:**

```
┌──────────────────────────────────┐
│  Current Image Preview (200px)   │
│  [Custom ✓] or [Inherited]       │
│  [Remove Override] (if custom)   │
├──────────────────────────────────┤
│  [Upload] [Browse] [URL]  tabs   │
├──────────────────────────────────┤
│                                  │
│  Tab content area                │
│  - Upload: Dropzone              │
│  - Browse: Image grid            │
│  - URL: TextInput + Set button   │
│                                  │
├──────────────────────────────────┤
│                         [Done]   │
└──────────────────────────────────┘
```

**Tab: Upload**
- Mantine `Dropzone` accepting jpeg/png/webp, max 5MB
- Accepts file drops from filesystem
- Accepts URL drops (detected via `dataTransfer.getData('text/uri-list')` or `text/plain`): sends `{ url }` to upload endpoint
- Click-to-browse file selection
- Shows upload progress spinner
- On success: calls `onSave(result.path)` immediately

**Tab: Browse**
- Fetches `GET /api/v1/admin/images/list` on first open (cached in state)
- 4-column grid of 80px square thumbnails, newest first
- Images in `inUseImages` set get a blue ring border
- Click selects: calls `onSave(image.path)` immediately

**Tab: URL**
- `TextInput` with placeholder "Paste image URL..."
- "Set" button calls `onSave(urlValue)` immediately
- No upload — saves the raw URL string as `item.image`

**Behavior:**
- Each action (upload, browse-select, URL-set, remove) takes effect immediately via `onSave()`
- Modal stays open after action so user sees preview update
- "Done" button closes modal
- No separate Save/Cancel flow

---

## Backend

### GET /api/v1/admin/images/list

**File:** `backend/src/4_api/v1/routers/admin/images.mjs`

**Response:**
```json
{
  "images": [
    {
      "filename": "019b436a-f458-711a-9517-32fca72b7dff.jpg",
      "path": "/media/img/lists/019b436a-f458-711a-9517-32fca72b7dff.jpg",
      "size": 45230,
      "modified": "2026-02-01T12:00:00Z"
    }
  ]
}
```

**Implementation:**
- `fs.readdirSync` on `{mediaPath}/img/lists/`
- `fs.statSync` for size and mtime per file
- Filter to allowed extensions (jpg, png, webp)
- Sort by modified descending (newest first)
- No pagination (bounded by manual uploads, currently 27 images)

### POST /api/v1/admin/images/upload (existing — add URL support)

**New optional field:** `{ url: "https://..." }` in JSON body (instead of multipart)

When `url` is provided:
1. Fetch the URL
2. Validate response content-type is an allowed image type
3. Save to `{mediaPath}/img/lists/{uuid}.{ext}`
4. Return same `{ ok, path, size, type }` response

---

## Integration

### ListsItemRow — col-icon click

**File:** `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx`

- New state: `const [imagePickerOpen, setImagePickerOpen] = useState(false)`
- `col-icon` div gets `onClick={() => setImagePickerOpen(true)}` and `style={{ cursor: 'pointer' }}`
- Render `<ImagePickerModal>` with:
  - `currentImage={item.image}`
  - `inheritedImage={rowThumbnail}`
  - `onSave={(path) => onUpdate({ image: path })}`
  - `inUseImages` from `ListsContext`
- On remove: `onSave(null)` → `onUpdate({ image: null })`

### ListsContext — inUseImages

**File:** `frontend/src/modules/Admin/ContentLists/ListsFolder.jsx`

- Compute `inUseImages` from items: `new Set(items.filter(i => i.image).map(i => i.image))`
- Add to `ListsContext` provider value

### ListsItemEditor — SimpleMode

**File:** `frontend/src/modules/Admin/ContentLists/ListsItemEditor.jsx`

- Replace `FileInput` + `Image` preview with a clickable thumbnail area + "Change Image" button
- Button opens `ImagePickerModal` with same props pattern
- `onSave` updates `formData.image` via `handleInputChange('image', path)`

### EditorCategories — IdentityCategory

**File:** `frontend/src/modules/Admin/ContentLists/EditorCategories.jsx`

- Replace `TextInput` for image (line 92-97) with clickable thumbnail + "Change Image" button
- Same `ImagePickerModal` integration as SimpleMode

---

## Edge Cases

| Case | Behavior |
|------|----------|
| No inherited image, no override | Preview shows dashed placeholder with "No image" text |
| Upload fails | Mantine notification (toast) with error, dropzone resets |
| URL drop with non-image URL | Backend validates content-type, returns 400; frontend shows error |
| Override points to deleted file | `ShimmerAvatar` fallback shows letter avatar gracefully |
| Concurrent edits | Last write wins (same as all other inline edits) |

---

## CSS

**File:** `frontend/src/modules/Admin/ContentLists/ContentLists.scss`

- `.col-icon` gets `cursor: pointer` on the avatar area
- `.image-picker-grid` — 4-column CSS grid for browse tab thumbnails
- `.image-picker-thumb` — 80px square, object-fit cover, border-radius
- `.image-picker-thumb.in-use` — blue ring via `box-shadow: 0 0 0 2px var(--mantine-color-blue-5)`
- `.image-picker-thumb.selected` — green ring for current selection
