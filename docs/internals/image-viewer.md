# Image Viewer & Asset Inspection Architecture

This document describes faah's first-class image viewing architecture: how standalone image files are loaded and rendered as interactive tabs, how viewport transforms and background modes work, and how inline images in Markdown documents are enhanced with a click-to-expand lightbox and error fallbacks.

---

## 1. Overview & Motivation

Modern software repositories increasingly contain visual assets: SVG icons, UI mockups, generated architectural diagrams, charts, favicon bundles, and asset pipelines. When pairing with coding agents that generate or modify images and documentation, developers need to inspect these visual outputs immediately without switching to an external tool or desktop previewer.

faah treats image formats (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, `.ico`, `.bmp`, `.avif`) as first-class documents alongside source code and Markdown.

```text
Tree / Palette Click
       │
       ▼
  openFile(path) ─── GET /api/file ───► { path, image: true, size: ... }
       │
       ├─► S.tabs.push({ isImage: true, imageScale: 1, imageFit: true, ... })
       │
       ▼
  syncImageView()
       │
       ├─► Hide #viewport, #mdview, #diffview
       ├─► Show #imgview
       ├─► Measure naturalWidth × naturalHeight
       └─► Apply initial fit transform & update HUD / Status Bar
```

---

## 2. Tab Lifecycle & Document Model

### Document state

When `/api/file` returns `image: true`, the document entry ([`web/src/editor/documents.js`](../../web/src/editor/documents.js)) gets `isImage: true` and no text buffer. Its view state lives on the entry, so it survives tab switches:

```javascript
image: { fit: true, scale: 1, panX: 0, panY: 0, bg: 'checker', pixelated: null },
imageMeta: null, // { width, height } once the image loads
```

`initialImage()` in [`web/src/viewers/view.js`](../../web/src/viewers/view.js) creates the `image` record. `pixelated: null` means "not chosen yet".

### Which view shows

`viewMode(document)` in `view.js` derives the view from the entry: `source` while editing, `image` for an image, `diff` when `diffMode` is set, otherwise the chosen preview or source. [`Viewers.jsx`](../../web/src/viewers/Viewers.jsx) mounts `ImageViewer` only for the image view, and the source viewport renders no rows while it is covered. Nothing is shown or hidden by hand.

### Reloads

`reloadOpenTabs()` skips image tabs; their zoom, pan and background stay on the entry. The image URL carries the document's `viewerRevision`, so invalidating the viewer reloads the file.

---

## 3. Image Viewer

[`web/src/viewers/ImageViewer.jsx`](../../web/src/viewers/ImageViewer.jsx) renders `#imgview` (viewport, canvas and image) and [`ImageHUD.jsx`](../../web/src/viewers/ImageHUD.jsx) the zoom and mode controls. Every change goes through named document actions (`updateImage`, `fitImage`, `actualImage`, `cycleImageBg`, `togglePixelated`) in [`viewers/actions.ts`](../../web/src/viewers/actions.js). The viewer owns its pointer, wheel and resize listeners and releases them on cleanup.

### Zoom math and fitting

[`image-math.js`](../../web/src/viewers/image-math.js) holds the tested calculations:

1. **Fit (`fit: true`)**:
   $$
   \text{fitScale} = \max\left(0.05, \min\left(1, \frac{\text{viewWidth} - 80}{\text{naturalWidth}}, \frac{\text{viewHeight} - 80}{\text{naturalHeight}}\right)\right)
   $$
   An image that already fits stays at 100%, so small icons are not upscaled.
2. **Manual scale (`fit: false`)**: `zoomScale` multiplies or divides by 1.25, clamped between 0.05 (5%) and 32 (3200%). The wheel uses a smaller step for small deltas and for pinch zoom.

`imageTransform` turns the view state into the canvas's `translate(panX, panY) scale(s)`.

### Panning

Dragging the viewport with the primary button pans. The pointer-down position and pan are captured; each move applies the delta (`panFrom`) and leaves fit mode. The cursor shows `grab`/`grabbing`.

### Background and rendering modes

`b` or the HUD button cycles the background: checkerboard (`.bg-checker`), dark and light, for checking transparency. `p` toggles smooth and pixelated rendering. On first load, images at most 64×64 px default to pixelated.

---

## 4. Markdown Inline Images & Lightbox

The preview's sanitizer ([`web/src/viewers/markdown-dom.js`](../../web/src/viewers/markdown-dom.js)) prepares Markdown images.

### Lazy loading

Every Markdown `<img>` gets `loading="lazy"` and `decoding="async"`, so off-screen images are not downloaded until scrolled near.

### Standalone image affordance

Standalone images get `.md-zoomable`: a hover outline and a `zoom-in` cursor.

### Lightbox

Clicking a zoomable image opens [`Lightbox.jsx`](../../web/src/viewers/Lightbox.jsx), a native modal dialog showing the image with its path or alt text. **Open in tab** opens the image as an editor tab; **Copy path** copies the repository path or remote URL. Escape, the close button or the backdrop close it.

### Broken image handling

Image errors do not bubble, so `PreviewContent` listens for them on its article in the capture phase and replaces a failed image with an `.md-img-broken` card reading "Image not found: <path>" (`brokenImageCard` in `markdown-dom.js`), instead of a broken-image icon.

---

## 5. Keyboard & Interaction Reference

When an image tab is active, the following keyboard controls are active:

| Key | Action | Description |
| :--- | :--- | :--- |
| `+` or `=` | Zoom In | Multiplies current scale by $1.25\times$ (up to $3200\%$) |
| `-` or `_` | Zoom Out | Divides current scale by $1.25\times$ (down to $5\%$) |
| `0` | Fit to Window | Fits image inside current viewport bounds |
| `1` | Actual Size (1:1) | Resets scale to $100\%$ ($1.0\times$) |
| `b` or `B` | Cycle Background | Cycles **Checkerboard** $\rightarrow$ **Dark** $\rightarrow$ **Light** |
| `p` or `P` | Toggle Mode | Toggles between **Smooth** and **Pixelated** interpolation |
| `↑` `↓` `←` `→` | Pan Canvas | Shifts view offset by 40 px in corresponding direction |
| Mouse Drag | Pan Canvas | Freeform drag-to-pan (`grab`/`grabbing` cursor) |
| Mouse Wheel | Interactive Zoom | Zooms in/out centered at viewport |
| `Esc` | Dismiss Overlays | Closes Markdown lightbox if open |
| `Alt+W` | Close Tab | Closes active image tab and returns to previous tab |
