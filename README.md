# MapMyPhotos

View your iPhone photos' GPS positions on an interactive 3D globe — completely free, no API keys required.

## Features

- **Drag & drop** photos onto the page, or use **Select Photos** (multi-select) / **Open Folder** (entire photo library folder)
- Reads **GPS coordinates** (latitude, longitude, altitude) from iPhone EXIF metadata
- Shows **compass heading** as an orange cone on the globe — the direction the photo was taken
- Click any **map marker** or sidebar item to see the full photo and all metadata
- **3D globe** powered by [CesiumJS](https://cesium.com/) with free OpenStreetMap imagery
- Works offline after first load (tiles cached by browser)

## How to run

### Option A — local server (quickest)

Most browsers block ES modules from `file://` URLs.  Spin up a tiny local server:

```bash
# Python 3
python3 -m http.server 8080

# Node.js (no install needed)
npx serve .
```

Then open <http://localhost:8080>.

### Option B — deploy for free

Push to GitHub and enable **GitHub Pages** (Settings → Pages → deploy from this branch, root `/`).
The site is pure static HTML/CSS/JS — no build step, no server required.

[Netlify](https://netlify.com) and [Vercel](https://vercel.com) also work by dropping the folder.

## iPhone photo tips

- Make sure **Location Services** is on for Camera (Settings → Privacy → Location Services → Camera → "While Using")
- The **orange cone** on the globe shows the compass direction the photo was taken (`GPSImgDirection` EXIF field)
- Altitude is GPS altitude above sea level
- HEIC files work best in Safari; other browsers read the EXIF metadata and show a JPEG-rendered thumbnail

## Tech stack

| Layer | Library |
|-------|---------|
| 3D globe | [CesiumJS 1.115](https://cesium.com/) — open source, free |
| EXIF parsing | [exifr 7](https://github.com/MikeKovarik/exifr) — MIT, free |
| Map tiles | [OpenStreetMap](https://www.openstreetmap.org/) — free, no key |
| Hosting | GitHub Pages / Netlify / Vercel — free |

**Zero API costs.** Everything runs in the browser.