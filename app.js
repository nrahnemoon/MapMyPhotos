/**
 * MapMyPhotos — app.js
 *
 * Reads GPS / heading EXIF data from iPhone photos and plots them on a
 * CesiumJS 3D globe.  Completely client-side; no API keys or costs required.
 */

import * as Exifr from 'https://cdn.jsdelivr.net/npm/exifr@7/dist/full.esm.js';

// ── State ──────────────────────────────────────────────────────────────────

let viewer = null;
let nextId = 0;
const photos = new Map();            // id -> photo object
const cesiumEntities = new Map();    // id -> { billboard, cone }
let selectedId = null;

// ── DOM refs ───────────────────────────────────────────────────────────────

const dropzone    = document.getElementById('dropzone');
const btnPick     = document.getElementById('btn-pick');
const btnFolder   = document.getElementById('btn-folder');
const btnViewAll  = document.getElementById('btn-view-all');
const btnClear    = document.getElementById('btn-clear');
const mapActions  = document.getElementById('map-actions');
const statusBar   = document.getElementById('status-bar');
const photoList   = document.getElementById('photo-list');
const emptyState  = document.getElementById('empty-state');
const fileInput   = document.getElementById('file-input');
const folderInput = document.getElementById('folder-input');
const globeLoad   = document.getElementById('globe-loading');
const modal       = document.getElementById('modal');
const modalClose  = document.getElementById('modal-close');
const modalImg    = document.getElementById('modal-img');
const modalMeta   = document.getElementById('modal-meta');
const modalFname  = document.getElementById('modal-filename');

// ── CesiumJS initialisation ────────────────────────────────────────────────

function initCesium() {
  // Suppress Ion — use only free OSM tiles
  Cesium.Ion.defaultAccessToken = undefined;

  viewer = new Cesium.Viewer('cesiumContainer', {
    imageryProvider: new Cesium.OpenStreetMapImageryProvider({
      url: 'https://tile.openstreetmap.org/',
      credit: '© OpenStreetMap contributors',
    }),
    terrainProvider: new Cesium.EllipsoidTerrainProvider(),
    baseLayerPicker: false,
    geocoder: false,
    homeButton: true,
    sceneModePicker: false,
    navigationHelpButton: false,
    animation: false,
    timeline: false,
    fullscreenButton: true,
    infoBox: false,
    selectionIndicator: false,
    shadows: false,
    skyBox: false,
    skyAtmosphere: false,
  });

  // Dark space background
  viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#0d1117');

  // Click → open photo detail
  viewer.screenSpaceEventHandler.setInputAction(movement => {
    const picked = viewer.scene.pick(movement.position);
    if (Cesium.defined(picked) && picked.id) {
      const props = picked.id.properties;
      if (props && props.hasProperty('photoId')) {
        const id = props.photoId.getValue();
        selectPhoto(id);
        openModal(id);
      }
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  globeLoad.classList.add('hidden');
}

// ── Add a photo marker to the globe ───────────────────────────────────────

async function addMarker(photo) {
  if (!viewer || !photo.lat) return;

  const position = Cesium.Cartesian3.fromDegrees(
    photo.lng, photo.lat, photo.alt ?? 0
  );

  // Round thumbnail via canvas
  const thumbDataUrl = await buildRoundThumb(photo.objectUrl);

  const billboard = viewer.entities.add({
    name: photo.filename,
    position,
    billboard: {
      image: thumbDataUrl || photo.objectUrl,
      width: 52,
      height: 52,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      pixelOffset: new Cesium.Cartesian2(0, -4),
    },
    properties: { photoId: photo.id },
  });

  const entry = { billboard };

  if (photo.heading != null) {
    entry.cone = addCone(photo.lat, photo.lng, photo.heading);
  }

  cesiumEntities.set(photo.id, entry);
}

function addCone(lat, lng, headingDeg, spreadDeg = 30, radiusM = 80) {
  const ALT = 2;
  const pts = [Cesium.Cartesian3.fromDegrees(lng, lat, ALT)];
  for (let a = headingDeg - spreadDeg / 2; a <= headingDeg + spreadDeg / 2; a += 4) {
    const r = (a * Math.PI) / 180;
    pts.push(Cesium.Cartesian3.fromDegrees(
      lng + (radiusM / 111320) * Math.sin(r),
      lat + (radiusM / 111320) * Math.cos(r),
      ALT
    ));
  }
  pts.push(Cesium.Cartesian3.fromDegrees(lng, lat, ALT));

  return viewer.entities.add({
    polygon: {
      hierarchy: new Cesium.PolygonHierarchy(pts),
      material: Cesium.Color.fromCssColorString('#f97316').withAlpha(0.45),
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    },
  });
}

// Circular-crop thumbnail via canvas
function buildRoundThumb(objectUrl) {
  return new Promise(resolve => {
    const SIZE = 64, BORDER = 3;
    const canvas = document.createElement('canvas');
    canvas.width = SIZE; canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.onload = () => {
      ctx.beginPath();
      ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - BORDER, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, 0, 0, SIZE, SIZE);
      ctx.beginPath();
      ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - BORDER / 2, 0, Math.PI * 2);
      ctx.strokeStyle = '#58a6ff';
      ctx.lineWidth = BORDER;
      ctx.stroke();
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve(null);
    img.src = objectUrl;
  });
}

// ── EXIF parsing ───────────────────────────────────────────────────────────

async function parseExif(file) {
  try {
    const exif = await Exifr.parse(file, {
      gps: true,
      pick: [
        'GPSImgDirection', 'GPSImgDirectionRef', 'GPSAltitude',
        'DateTimeOriginal', 'Make', 'Model',
      ],
    });
    // exifr auto-converts GPS DMS to decimal .latitude / .longitude
    return {
      lat:        exif?.latitude  ?? null,
      lng:        exif?.longitude ?? null,
      alt:        exif?.GPSAltitude ?? null,
      heading:    exif?.GPSImgDirection ?? null,
      headingRef: exif?.GPSImgDirectionRef ?? null,
      timestamp:  exif?.DateTimeOriginal ?? null,
      make:       exif?.Make?.trim() ?? null,
      model:      exif?.Model?.trim() ?? null,
    };
  } catch {
    return {};
  }
}

// ── Process uploaded files ─────────────────────────────────────────────────

async function processFiles(files) {
  const imageFiles = [...files].filter(f => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
  if (!imageFiles.length) return;

  setLoading(true, `Processing 0 / ${imageFiles.length}…`);

  for (let i = 0; i < imageFiles.length; i++) {
    const file = imageFiles[i];
    setLoading(true, `Processing ${i + 1} / ${imageFiles.length}…`);
    await processOneFile(file);
  }

  setLoading(false, summaryStat());
  updateMapActions();
}

async function processOneFile(file) {
  const exif = await parseExif(file);
  const objectUrl = URL.createObjectURL(file);
  const id = nextId++;

  const photo = {
    id,
    filename: file.name,
    objectUrl,
    lat:        exif.lat,
    lng:        exif.lng,
    alt:        exif.alt,
    heading:    exif.heading,
    headingRef: exif.headingRef,
    timestamp:  exif.timestamp,
    make:       exif.make,
    model:      exif.model,
  };

  photos.set(id, photo);
  renderListItem(photo);

  if (photo.lat != null) {
    await addMarker(photo);
  }
}

// ── Sidebar list rendering ─────────────────────────────────────────────────

function renderListItem(photo) {
  emptyState.hidden = true;

  const item = document.createElement('div');
  item.className = 'photo-item';
  item.dataset.id = photo.id;
  item.setAttribute('role', 'listitem');
  item.tabIndex = 0;

  // Thumbnail
  const thumb = document.createElement('img');
  thumb.className = 'photo-thumb';
  thumb.src = photo.objectUrl;
  thumb.alt = photo.filename;
  thumb.loading = 'lazy';
  thumb.onerror = () => {
    const ph = document.createElement('div');
    ph.className = 'photo-thumb-placeholder';
    ph.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
    thumb.replaceWith(ph);
  };

  // Info column
  const info = document.createElement('div');
  info.className = 'photo-info';

  const name = document.createElement('div');
  name.className = 'photo-name';
  name.textContent = photo.filename;

  info.appendChild(name);

  if (photo.lat != null) {
    const coords = document.createElement('div');
    coords.className = 'photo-coords';
    coords.textContent = `${photo.lat.toFixed(5)}, ${photo.lng.toFixed(5)}`;
    info.appendChild(coords);

    if (photo.heading != null) {
      const hdg = document.createElement('div');
      hdg.className = 'photo-heading';
      hdg.textContent = `↗ ${photo.heading.toFixed(1)}° ${compassDir(photo.heading)}`;
      info.appendChild(hdg);
    }
  } else {
    const noGps = document.createElement('div');
    noGps.className = 'photo-no-gps';
    noGps.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="1" y1="1" x2="23" y2="23"/><path d="M21 3L3 21"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/></svg> No GPS data`;
    info.appendChild(noGps);
  }

  // Chevron
  const chevron = document.createElement('span');
  chevron.className = 'chevron';
  chevron.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>`;

  item.append(thumb, info, chevron);

  const onClick = () => {
    selectPhoto(photo.id);
    if (photo.lat != null) {
      flyToPhoto(photo);
    }
    openModal(photo.id);
  };
  item.addEventListener('click', onClick);
  item.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') onClick(); });

  photoList.appendChild(item);
}

// ── Selection ──────────────────────────────────────────────────────────────

function selectPhoto(id) {
  if (selectedId != null) {
    document.querySelector(`.photo-item[data-id="${selectedId}"]`)?.classList.remove('active');
  }
  selectedId = id;
  document.querySelector(`.photo-item[data-id="${id}"]`)?.classList.add('active');
}

// ── Globe navigation ───────────────────────────────────────────────────────

function flyToPhoto(photo) {
  viewer?.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(
      photo.lng, photo.lat, Math.max((photo.alt ?? 0) + 500, 500)
    ),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch:   Cesium.Math.toRadians(-40),
      roll:    0,
    },
    duration: 1.5,
  });
}

function flyToAll() {
  if (!viewer || viewer.entities.values.length === 0) return;
  viewer.flyTo(viewer.entities, { duration: 1.5 });
}

function clearAll() {
  photos.forEach(p => URL.revokeObjectURL(p.objectUrl));
  photos.clear();
  cesiumEntities.clear();
  viewer?.entities.removeAll();
  photoList.innerHTML = '';
  photoList.appendChild(emptyState);
  emptyState.hidden = false;
  selectedId = null;
  nextId = 0;
  setLoading(false, '');
  updateMapActions();
}

// ── Modal ──────────────────────────────────────────────────────────────────

function openModal(id) {
  const photo = photos.get(id);
  if (!photo) return;

  modalFname.textContent = photo.filename;
  modalImg.src = photo.objectUrl;
  modalImg.alt = photo.filename;

  // Build metadata rows
  const rows = [];

  const icon = (path) => `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${path}</svg>`;

  if (photo.lat != null) {
    rows.push(metaRow(
      icon('<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'),
      'Latitude',
      toDMS(photo.lat, true),
      photo.lat.toFixed(6)
    ));
    rows.push(metaRow(
      icon('<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'),
      'Longitude',
      toDMS(photo.lng, false),
      photo.lng.toFixed(6)
    ));
    if (photo.alt != null) {
      rows.push(metaRow(
        icon('<path d="M8 3l4-2 4 2"/><path d="M12 22V8"/><path d="m17 8-5-5-5 5"/>'),
        'Altitude',
        `${photo.alt.toFixed(1)} m above sea level`
      ));
    }
    if (photo.heading != null) {
      const ref = photo.headingRef === 'T' ? 'True North' : photo.headingRef === 'M' ? 'Magnetic North' : '';
      rows.push(metaRow(
        icon('<circle cx="12" cy="12" r="10"/><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>'),
        'Heading',
        `${photo.heading.toFixed(1)}° ${compassDir(photo.heading)}${ref ? ' · ' + ref : ''}`,
        null,
        'meta-orange'
      ));
    }
  } else {
    rows.push(metaRow(
      icon('<line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/>'),
      'Location',
      'No GPS data in this photo',
      null,
      'meta-dim'
    ));
  }

  if (photo.timestamp) {
    rows.push(metaRow(
      icon('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
      'Captured',
      formatDate(photo.timestamp)
    ));
  }

  rows.push(metaRow(
    icon('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>'),
    'Camera',
    [photo.make, photo.model].filter(Boolean).join(' ') || 'Unknown'
  ));

  modalMeta.innerHTML = rows.join('');
  modal.classList.remove('hidden');
}

function metaRow(iconHtml, label, value, sub = null, valueClass = '') {
  return `<tr>
    <td>${iconHtml}</td>
    <td>${label}</td>
    <td class="${valueClass}">${value}${sub ? `<span class="meta-sub">${sub}</span>` : ''}</td>
  </tr>`;
}

function closeModal() {
  modal.classList.add('hidden');
  modalImg.src = '';
}

// ── Utilities ──────────────────────────────────────────────────────────────

function compassDir(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}

function toDMS(dd, isLat) {
  const dir = dd >= 0 ? (isLat ? 'N' : 'E') : (isLat ? 'S' : 'W');
  const abs = Math.abs(dd);
  const d = Math.floor(abs);
  const mFull = (abs - d) * 60;
  const m = Math.floor(mFull);
  const s = ((mFull - m) * 60).toFixed(1);
  return `${d}° ${m}' ${s}" ${dir}`;
}

function formatDate(dt) {
  // dt may be a Date object or string from exifr
  const d = dt instanceof Date ? dt : new Date(dt);
  if (isNaN(d)) return String(dt);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}  ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function summaryStat() {
  const total = photos.size;
  const mapped = [...photos.values()].filter(p => p.lat != null).length;
  return `${total} photo${total === 1 ? '' : 's'} · ${mapped} mapped`;
}

function setLoading(loading, msg) {
  [btnPick, btnFolder].forEach(b => b.disabled = loading);
  statusBar.innerHTML = loading
    ? `<span class="spinner-sm"></span><span>${msg}</span>`
    : `<span>${msg}</span>`;
}

function updateMapActions() {
  mapActions.hidden = photos.size === 0;
}

// ── Event wiring ───────────────────────────────────────────────────────────

// Drag-and-drop
dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
dropzone.addEventListener('drop', e => {
  e.preventDefault();
  dropzone.classList.remove('drag-over');
  processFiles(e.dataTransfer.files);
});
dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });

// Buttons
btnPick.addEventListener('click', () => fileInput.click());
btnFolder.addEventListener('click', () => folderInput.click());
btnViewAll.addEventListener('click', flyToAll);
btnClear.addEventListener('click', clearAll);

// File inputs
fileInput.addEventListener('change', () => { processFiles(fileInput.files); fileInput.value = ''; });
folderInput.addEventListener('change', () => { processFiles(folderInput.files); folderInput.value = ''; });

// Modal close
modalClose.addEventListener('click', closeModal);
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ── Boot ───────────────────────────────────────────────────────────────────
initCesium();
