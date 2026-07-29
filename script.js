const SUPABASE_URL =
  "https://aywbgpsgihbginuyuxpn.supabase.co";

const SUPABASE_ANON_KEY =
  "sb_publishable_gKk-hEOT-RC7M1xkJQU7uA_0VJz8-pF";

const supabaseClient = supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

const defaultCenter = [52.0, 19.0];
const defaultZoom = 6;
const map = L.map('map').setView(defaultCenter, defaultZoom);

const darkOsmLayer = L.tileLayer(
  'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }
);

const osmLayer = L.tileLayer(
  'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }
);

const topoLayer = L.tileLayer(
  'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
  {
    maxZoom: 17,
    attribution: '&copy; OpenTopoMap'
  }
);

const satelliteLayer = L.tileLayer(
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  {
    attribution: 'Tiles © Esri'
  }
);

osmLayer.addTo(map);

let data;
let layer;
let firstLoad = true;
let powiaty = [];
let gminy = [];
let miejscowosci = [];
let legendy = [];

function supabaseRowsToGeoJson(rows) {
  return {
    type: "FeatureCollection",

    features: rows
      .filter(row => {
        if (
          row.lat === null ||
          row.lat === "" ||
          row.lng === null ||
          row.lng === ""
        ) {
          return false;
        }

        const lat = Number(row.lat);
        const lng = Number(row.lng);

        return (
          Number.isFinite(lat) &&
          Number.isFinite(lng) &&
          lat >= -90 &&
          lat <= 90 &&
          lng >= -180 &&
          lng <= 180
        );
      })
      .map(row => ({
        type: "Feature",

        properties: {
          /*
           * Obecny kod popupów i panelu szczegółów
           * wyszukuje obiekty po properties.fid.
           */
          fid: row.id,
          id: row.id,

          nazwa: row.nazwa || "",
          kategoria: row.kategoria || "",
          opis: row.opis || "",

          typ_miejsca: row.typ_miejsca || "",
          dokladnosc_miejsca:
            row.dokladnosc_miejsca || "",

          miejscowosc: row.miejscowosc || "",
          gmina: row.gmina || "",
          powiat: row.powiat || "",
          wojewodztwo: row.wojewodztwo || "",

          typ_zrodla: row.typ_zrodla || "",
          osoba_przekazujaca:
            row.osoba_przekazujaca || "",

          typ_okresu: row.typ_okresu || "nieznany",
          dokladna_data: row.dokladna_data || null,
          ogolny_okres: row.ogolny_okres || null,

          data_dodania: row.data_dodania || null,

          zdjecia: Array.isArray(row.zdjecia)
            ? row.zdjecia
              .filter(photo => photo?.url)
              .map(photo => ({
                id: photo.id,
                url: photo.url,
                path: photo.sciezka || "",
                caption: photo.podpis || "",
                createdAt: photo.data_dodania || null
              }))
            : [],

          status: row.status
        },

        geometry: {
          type: "Point",
          coordinates: [
            Number(row.lng),
            Number(row.lat)
          ]
        }
      }))
  };
}

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const periodLabels = {
  0: 'Dawno temu...',
  1: 'XVIII wiek',
  2: 'XIX wiek',
  3: 'XX wiek',
  4: 'XXI wiek'
};

function yearToPeriodIndex(year) {
  if (!year) return null;

  if (year < 1701) return 0;
  if (year <= 1800) return 1;
  if (year <= 1900) return 2;
  if (year <= 2000) return 3;

  return 4;
}

function periodTextToIndex(value) {
  const v = normalize(value);

  if (v.includes('dawno')) return 0;
  if (v.includes('xviii')) return 1;
  if (v.includes('xix')) return 2;
  if (v.includes('xxi')) return 4;
  if (v.includes('xx')) return 3;

  return null;
}

function getFeaturePeriodIndex(properties) {
  const type = normalize(properties.typ_okresu);

  if (type === 'nieznany') {
    return null;
  }

  if (type === 'dokładna data') {
    const rawDate = properties.dokladna_data;

    if (!rawDate) return null;

    const year = Number(String(rawDate).slice(0, 4));

    return yearToPeriodIndex(year);
  }

  if (type === 'ogólny okres') {
    return periodTextToIndex(properties.ogolny_okres);
  }

  return null;
}

function getPeriodDescription(properties) {
  const type = normalize(properties.typ_okresu);

  if (type === 'nieznany') {
    return 'Nieznany';
  }

  if (type === 'dokładna data') {
    return properties.dokladna_data || '-';
  }

  if (type === 'ogólny okres') {
    return properties.ogolny_okres || '-';
  }

  return '-';
}

function activePeriodRange() {
  const fromInput = document.querySelector('#period-from');
  const toInput = document.querySelector('#period-to');

  let from = Number(fromInput?.value ?? 0);
  let to = Number(toInput?.value ?? 4);

  if (from > to) {
    [from, to] = [to, from];
  }

  return { from, to };
}

function updatePeriodLabels() {
  const { from, to } = activePeriodRange();

  const fromLabel = document.querySelector('#period-from-label');
  const toLabel = document.querySelector('#period-to-label');

  if (fromLabel) fromLabel.textContent = periodLabels[from];
  if (toLabel) toLabel.textContent = periodLabels[to];
}

function getAccuracyDescription(value) {

  const v = normalize(value);

  switch (v) {

    case 'dokładna':
      return '🟢 Dokładna (do 10 m)';

    case 'przybliżona':
      return '🟡 Przybliżona (10–50 m)';

    case 'orientacyjna':
      return '🟠 Orientacyjna (50–200 m)';

    case 'ogólna':
      return '🔴 Ogólna (powyżej 200 m)';

    default:
      return value || '-';
  }

}

function activeLegendSearch() {
  const input = document.querySelector('#legend-search');
  return normalize(input ? input.value : '');

}

const categoryIcons = {
  'lokalna legenda': '📜',
  'nawiedzone miejsce': '👻',
  'opuszczony obiekt': '🏚️',
  'tragiczne wydarzenie': '⚰️',
  'obserwacja ufo': '🛸',
  'kryptozoologia': '🐺',
  'niewyjaśnione zjawisko': '❓'
};

const placeIcons = {
  'las': '🌲',
  'droga': '🚗',
  'most': '🌉',
  'dom': '🏠',
  'opuszczony budynek': '🏚️',
  'ruiny': '🧱',
  'cmentarz': '⚰️',
  'kościół': '⛪',
  'kapliczka': '✝️',
  'zamek': '🏰',
  'pałac': '🏛️',
  'jezioro': '🏞️',
  'rzeka': '🌊',
  'staw': '🦆',
  'bagno': '🌫️',
  'góra': '⛰️',
  'wzgórze': '🌄',
  'jaskinia': '🦇',
  'park': '🌳',
  'pole': '🌾',
  'łąka': '🌼',
  'niebo': '🌌',
  'inne': '🤔'
};

function getPlaceIcon(place) {
  return placeIcons[normalize(place)] || '📍';
}

function getCategoryIcon(category) {
  return categoryIcons[normalize(category)] || '📍';
}

function createCategoryMarker(feature) {
  const icon = getCategoryIcon(feature.properties.kategoria);

  return L.divIcon({
    className: 'category-marker',
    html: `<div class="marker-pin"><span>${icon}</span></div>`,
    iconSize: [34, 44],
    iconAnchor: [17, 42],
    popupAnchor: [0, -38]
  });
}

function popup(feature) {
  const p = feature.properties;

  return `
    <div class="popup-card">
      <div class="popup-title">
        ${escapeHtml(p.nazwa || "Bez nazwy")}
      </div>

      <button
        class="popup-more"
        onclick="showDetails(${Number(p.fid)})"
      >
        Więcej
      </button>
    </div>
  `;
}

function activeValues(selector) {
  return [...document.querySelectorAll(selector + ':checked')]
    .map(input => normalize(input.value));
}

function activePowiat() {
  const input = document.querySelector('#powiat-search');
  return normalize(input ? input.value : '');
}

function activeGmina() {
  const input = document.querySelector('#gmina-search');
  return normalize(input ? input.value : '');
}

function activeMiejscowosc() {
  const input = document.querySelector('#miejscowosc-search');
  return normalize(input ? input.value : '');
}

function buildLegendaArray() {
  if (!data) return;

  legendy = [...new Set(
    data.features
      .map(feature => feature.properties.nazwa)
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, 'pl'));
}

function buildPowiatArray() {
  if (!data) return;

  powiaty = [...new Set(
    data.features
      .map(feature => feature.properties.powiat)
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, 'pl'));
}

function buildGminaArray() {
  if (!data) return;

  gminy = [...new Set(
    data.features
      .map(feature => feature.properties.gmina)
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, 'pl'));
}

function buildMiejscowoscArray() {

  if (!data) return;

  miejscowosci = [...new Set(
    data.features
      .map(feature => feature.properties.miejscowosc)
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, 'pl'));

}

function showPowiatHint() {
  const input = document.querySelector('#powiat-search');
  const hint = document.querySelector('#powiat-hint');

  if (!input || !hint) return;

  const query = normalize(input.value);
  hint.innerHTML = '';

  if (query.length < 1) {
    hint.style.display = 'none';
    return;
  }

  const matches = powiaty
    .filter(powiat => normalize(powiat).includes(query))
    .slice(0, 5);

  if (matches.length === 0) {
    hint.style.display = 'none';
    return;
  }

  matches.forEach(powiat => {
    const item = document.createElement('div');
    item.className = 'powiat-hint-item';
    item.textContent = powiat;

    item.addEventListener('click', () => {
      input.value = powiat;
      hint.style.display = 'none';
      render();
    });

    hint.appendChild(item);
  });

  hint.style.display = 'block';
}

function showGminaHint() {
  const input = document.querySelector('#gmina-search');
  const hint = document.querySelector('#gmina-hint');

  if (!input || !hint) return;

  const query = normalize(input.value);
  hint.innerHTML = '';

  if (query.length < 1) {
    hint.style.display = 'none';
    return;
  }

  const matches = gminy
    .filter(gmina => normalize(gmina).includes(query))
    .slice(0, 5);

  if (matches.length === 0) {
    hint.style.display = 'none';
    return;
  }

  matches.forEach(gmina => {
    const item = document.createElement('div');
    item.className = 'powiat-hint-item';
    item.textContent = gmina;

    item.addEventListener('click', () => {
      input.value = gmina;
      hint.style.display = 'none';
      render();
    });

    hint.appendChild(item);
  });

  hint.style.display = 'block';
}

function showMiejscowoscHint() {

  const input = document.querySelector('#miejscowosc-search');
  const hint = document.querySelector('#miejscowosc-hint');

  if (!input || !hint) return;

  const query = normalize(input.value);

  hint.innerHTML = '';

  if (query.length < 1) {

    hint.style.display = 'none';
    return;

  }

  const matches = miejscowosci
    .filter(x => normalize(x).includes(query))
    .slice(0, 5);

  if (matches.length === 0) {

    hint.style.display = 'none';
    return;

  }

  matches.forEach(miejscowosc => {

    const item = document.createElement('div');

    item.className = 'powiat-hint-item';

    item.textContent = miejscowosc;

    item.addEventListener('click', () => {

      input.value = miejscowosc;

      hint.style.display = 'none';

      render();

    });

    hint.appendChild(item);

  });

  hint.style.display = 'block';

}

function showLegendaHint() {
  const input = document.querySelector('#legend-search');
  const hint = document.querySelector('#legend-hint');

  if (!input || !hint) return;

  const query = normalize(input.value);
  hint.innerHTML = '';

  if (query.length < 1) {
    hint.style.display = 'none';
    return;
  }

  const matches = legendy
    .filter(nazwa => normalize(nazwa).includes(query))
    .slice(0, 5);

  if (matches.length === 0) {
    hint.style.display = 'none';
    return;
  }

  matches.forEach(nazwa => {
    const item = document.createElement('div');
    item.className = 'powiat-hint-item';
    item.textContent = nazwa;

    item.addEventListener('click', () => {
      input.value = nazwa;
      hint.style.display = 'none';
      render();
    });

    hint.appendChild(item);
  });

  hint.style.display = 'block';
}

function render() {
  if (!data) return;

  if (layer) {
    map.removeLayer(layer);
  }

  const activeCategories = activeValues('.filter-category');
  const activePlaces = activeValues('.filter-place');
  const activeWoj = activeValues('.filter-woj');
  const powiatSearch = activePowiat();
  const gminaSearch = activeGmina();
  const miejscowoscSearch = activeMiejscowosc();
  const legendSearch = activeLegendSearch();

  const periodRange = activePeriodRange();
  const showUnknownPeriod =
    document.querySelector('#show-unknown-period')?.checked ?? true;

  const filtered = {
    type: "FeatureCollection",
    features: data.features.filter(feature => {

      const category = normalize(feature.properties.kategoria);
      const place = normalize(feature.properties.typ_miejsca);
      const woj = normalize(feature.properties.wojewodztwo);
      const powiat = normalize(feature.properties.powiat);
      const gmina = normalize(feature.properties.gmina);
      const miejscowosc = normalize(feature.properties.miejscowosc);
      const nazwa = normalize(feature.properties.nazwa);
      const periodIndex = getFeaturePeriodIndex(feature.properties);

      return activeCategories.includes(category) &&
        activePlaces.includes(place) &&
        activeWoj.includes(woj) &&
        (powiatSearch === '' || powiat.includes(powiatSearch)) &&
        (gminaSearch === '' || gmina.includes(gminaSearch)) &&
        (miejscowoscSearch === '' || miejscowosc.includes(miejscowoscSearch)) &&
        (legendSearch === '' || nazwa.includes(legendSearch)) &&
        (periodIndex === null ? showUnknownPeriod : periodIndex >= periodRange.from && periodIndex <= periodRange.to);
    })
  };

  const counter = document.querySelector('#legend-counter');

  counter.textContent =
    `Wyświetlono ${filtered.features.length} z ${data.features.length} miejsc`;

  const geojsonLayer = L.geoJSON(filtered, {
    onEachFeature: (feature, lyr) => {
      lyr.bindPopup(popup(feature));
    },
    pointToLayer: (feature, latlng) => {
      return L.marker(latlng, {
        icon: createCategoryMarker(feature)
      });
    }
  });

  if (L.markerClusterGroup) {
    const markers = L.markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 45,
      spiderfyOnMaxZoom: true,
      disableClusteringAtZoom: 15
    });

    markers.addLayer(geojsonLayer);
    layer = markers;
  } else {
    console.warn("MarkerCluster nie został załadowany — używam zwykłej warstwy GeoJSON.");
    layer = geojsonLayer;
  }

  layer.addTo(map);

  if (firstLoad) {

    map.setView(defaultCenter, defaultZoom);

    firstLoad = false;

  }

  console.log("Wczytane obiekty:", data.features.length);
  console.log("Widoczne obiekty:", filtered.features.length);
}



function updateToggleButtons() {
  document.querySelectorAll('.toggle-section').forEach(button => {
    const targetClass = button.dataset.target;
    const inputs = document.querySelectorAll(`.${targetClass}`);
    const allChecked = [...inputs].every(input => input.checked);

    button.textContent = allChecked ? '✕' : '✓';
  });
}

function buildDetailsGalleryButton(photos) {
  if (!Array.isArray(photos) || photos.length === 0) {
    return "";
  }

  return `
    <section class="details-gallery-section">
      <button
        type="button"
        id="toggle-details-gallery"
        class="details-gallery-toggle"
        aria-expanded="false"
      >
        <span>📷 Zobacz zdjęcia</span>
        <small>${photos.length}</small>
      </button>

      <div
        id="details-gallery-container"
        class="details-gallery-container hidden"
      ></div>
    </section>
  `;
}

function buildDetailsGalleryContent(photos, placeName) {
  if (!Array.isArray(photos) || photos.length === 0) {
    return "";
  }

  const mainPhoto = photos[0];

  const thumbnails = photos.map((photo, index) => `
    <button
      type="button"
      class="details-photo-thumb ${index === 0 ? "active" : ""}"
      data-photo-index="${index}"
      aria-label="Pokaż zdjęcie ${index + 1}"
    >
      <img
        src="${escapeHtml(photo.url)}"
        alt="${escapeHtml(
    photo.caption ||
    `${placeName || "Zdjęcie miejsca"} — zdjęcie ${index + 1}`
  )}"
        loading="lazy"
      >
    </button>
  `).join("");

  return `
    <div class="details-gallery">
      <button
        type="button"
        class="details-main-photo"
        id="details-main-photo"
        aria-label="Otwórz zdjęcie w pełnym rozmiarze"
      >
        <img
          id="details-main-photo-image"
          src="${escapeHtml(mainPhoto.url)}"
          alt="${escapeHtml(
    mainPhoto.caption ||
    placeName ||
    "Zdjęcie miejsca"
  )}"
        >

        <span class="details-photo-zoom">
          Powiększ
        </span>
      </button>

      ${photos.length > 1
      ? `
            <div class="details-photo-thumbnails">
              ${thumbnails}
            </div>
          `
      : ""
    }

      <p
        id="details-photo-caption"
        class="details-photo-caption"
      >
        ${escapeHtml(mainPhoto.caption || "")}
      </p>
    </div>
  `;
}

function setupDetailsGallery(photos, placeName) {
  if (!Array.isArray(photos) || !photos.length) {
    return;
  }

  const mainImage =
    document.querySelector("#details-main-photo-image");

  const mainButton =
    document.querySelector("#details-main-photo");

  const caption =
    document.querySelector("#details-photo-caption");

  const thumbnailButtons = [
    ...document.querySelectorAll(
      ".details-photo-thumb"
    )
  ];

  let activeIndex = 0;

  function setActivePhoto(index) {
    const photo = photos[index];

    if (!photo || !mainImage) {
      return;
    }

    activeIndex = index;

    mainImage.src = photo.url;
    mainImage.alt =
      photo.caption ||
      `${placeName || "Zdjęcie miejsca"} — zdjęcie ${index + 1}`;

    if (caption) {
      caption.textContent = photo.caption || "";
    }

    thumbnailButtons.forEach((button, buttonIndex) => {
      button.classList.toggle(
        "active",
        buttonIndex === index
      );
    });
  }

  thumbnailButtons.forEach(button => {
    button.addEventListener("click", () => {
      setActivePhoto(
        Number(button.dataset.photoIndex)
      );
    });
  });

  mainButton?.addEventListener("click", () => {
    openPublicPhotoLightbox(
      photos,
      activeIndex,
      placeName
    );
  });
}

function setupDetailsGalleryToggle(photos, placeName) {
  const toggle =
    document.querySelector("#toggle-details-gallery");

  const container =
    document.querySelector("#details-gallery-container");

  if (!toggle || !container || !photos.length) {
    return;
  }

  let galleryCreated = false;

  toggle.addEventListener("click", () => {
    const isOpen =
      toggle.getAttribute("aria-expanded") === "true";

    if (!galleryCreated) {
      container.innerHTML =
        buildDetailsGalleryContent(
          photos,
          placeName
        );

      setupDetailsGallery(
        photos,
        placeName
      );

      galleryCreated = true;
    }

    container.classList.toggle(
      "hidden",
      isOpen
    );

    toggle.setAttribute(
      "aria-expanded",
      String(!isOpen)
    );

    const label = toggle.querySelector("span");

    if (label) {
      label.textContent = isOpen
        ? "📷 Zobacz zdjęcia"
        : "📷 Ukryj zdjęcia";
    }
  });
}

let publicLightboxPhotos = [];
let publicLightboxIndex = 0;
let publicLightboxPlaceName = "";

function renderPublicPhotoLightbox() {
  const lightbox =
    document.querySelector("#publicPhotoLightbox");

  const image =
    document.querySelector("#publicPhotoLightboxImage");

  const caption =
    document.querySelector("#publicPhotoLightboxCaption");

  const counter =
    document.querySelector("#publicPhotoLightboxCounter");

  const previous =
    document.querySelector("#publicPhotoPrevious");

  const next =
    document.querySelector("#publicPhotoNext");

  const photo =
    publicLightboxPhotos[publicLightboxIndex];

  if (!lightbox || !image || !photo) {
    return;
  }

  image.src = photo.url;

  image.alt =
    photo.caption ||
    `${publicLightboxPlaceName} — zdjęcie ${publicLightboxIndex + 1}`;

  if (caption) {
    caption.textContent =
      photo.caption || publicLightboxPlaceName;
  }

  if (counter) {
    counter.textContent =
      `${publicLightboxIndex + 1} / ${publicLightboxPhotos.length}`;
  }

  const showNavigation =
    publicLightboxPhotos.length > 1;

  if (previous) {
    previous.hidden = !showNavigation;
  }

  if (next) {
    next.hidden = !showNavigation;
  }
}

function openPublicPhotoLightbox(
  photos,
  startIndex = 0,
  placeName = ""
) {
  const lightbox =
    document.querySelector("#publicPhotoLightbox");

  if (!lightbox || !photos.length) {
    return;
  }

  publicLightboxPhotos = photos;
  publicLightboxIndex = startIndex;
  publicLightboxPlaceName = placeName;

  renderPublicPhotoLightbox();

  lightbox.classList.remove("hidden");
  lightbox.setAttribute("aria-hidden", "false");

  document.body.classList.add(
    "public-photo-lightbox-open"
  );
}

function closePublicPhotoLightbox() {
  const lightbox =
    document.querySelector("#publicPhotoLightbox");

  const image =
    document.querySelector("#publicPhotoLightboxImage");

  if (!lightbox) return;

  lightbox.classList.add("hidden");
  lightbox.setAttribute("aria-hidden", "true");

  if (image) {
    image.src = "";
  }

  publicLightboxPhotos = [];
  publicLightboxIndex = 0;
  publicLightboxPlaceName = "";

  document.body.classList.remove(
    "public-photo-lightbox-open"
  );
}

function showPreviousPublicPhoto() {
  if (!publicLightboxPhotos.length) return;

  publicLightboxIndex =
    (
      publicLightboxIndex -
      1 +
      publicLightboxPhotos.length
    ) % publicLightboxPhotos.length;

  renderPublicPhotoLightbox();
}

function showNextPublicPhoto() {
  if (!publicLightboxPhotos.length) return;

  publicLightboxIndex =
    (
      publicLightboxIndex + 1
    ) % publicLightboxPhotos.length;

  renderPublicPhotoLightbox();
}

function showDetails(fid) {
  const feature = data.features.find(
    f => Number(f.properties.fid) === Number(fid)
  );

  if (!feature) return;

  const p = feature.properties;

  const photos = Array.isArray(p.zdjecia)
    ? p.zdjecia
    : [];

  const panel =
    document.querySelector("#details-panel");

  const content =
    document.querySelector("#details-content");

  content.innerHTML = `
    <h2>${escapeHtml(p.nazwa || "Bez nazwy")}</h2>

    <div class="detail-category">
      <div class="detail-icon">
        ${getCategoryIcon(p.kategoria)}
      </div>

      <div class="detail-badge">
        ${escapeHtml(p.kategoria || "-")}
      </div>
    </div>

    <p class="details-description">
      ${escapeHtml(p.opis || "Brak opisu.")}
    </p>

    <hr>

    <div class="details-attributes">
      <p>
        <b>Typ miejsca:</b><br>
        ${getPlaceIcon(p.typ_miejsca)}
        ${escapeHtml(p.typ_miejsca || "-")}
      </p>

      <p>
        <b>Dokładność lokalizacji:</b><br>
        ${escapeHtml(
    getAccuracyDescription(
      p.dokladnosc_miejsca
    )
  )}
      </p>

      <p>
        <b>Data/okres zjawiska:</b>
        ${escapeHtml(getPeriodDescription(p))}
      </p>

      <p>
        <b>Miejscowość:</b>
        ${escapeHtml(p.miejscowosc || "-")}
      </p>

      <p>
        <b>Gmina:</b>
        ${escapeHtml(p.gmina || "-")}
      </p>

      <p>
        <b>Powiat:</b>
        ${escapeHtml(p.powiat || "-")}
      </p>

      <p>
        <b>Województwo:</b>
        ${escapeHtml(p.wojewodztwo || "-")}
      </p>

      <p>
        <b>Źródło:</b>
        ${escapeHtml(p.typ_zrodla || "-")}
      </p>
    </div>

    ${buildDetailsGalleryButton(photos)}
  `;

  setupDetailsGalleryToggle(
    photos,
    p.nazwa
  );

  panel.classList.add("open");
  document
    .querySelector(".top-bar")
    ?.classList.add("panel-open");

  document
    .querySelector(".basemap-control")
    .classList.add("details-open");

  document
    .querySelector(".leaflet-bottom.leaflet-right")
    ?.classList.add("details-open");
}

document.querySelector('#close-details').addEventListener('click', () => {
  document
    .querySelector('#details-panel')
    .classList.remove('open');

  document
    .querySelector('.basemap-control')
    .classList.remove('details-open');

  document
    .querySelector('.leaflet-bottom.leaflet-right')
    ?.classList.remove('details-open');

  document
    .querySelector('.top-bar')
    ?.classList.remove('panel-open');
});

async function loadPublishedPlaces() {
  console.log(
    "Pobieranie opublikowanych obiektów z Supabase..."
  );

  const { data: rows, error } = await supabaseClient
    .from("zgloszenia")
    .select(`
      id,
      nazwa,
      kategoria,
      opis,
      typ_miejsca,
      dokladnosc_miejsca,
      miejscowosc,
      gmina,
      powiat,
      wojewodztwo,
      typ_zrodla,
      osoba_przekazujaca,
      typ_okresu,
      dokladna_data,
      ogolny_okres,
      data_dodania,
      lat,
      lng,
      status,
      zdjecia (
        id,
        url,
        sciezka,
        podpis,
        data_dodania
      )
    `)
    .eq("status", "opublikowany")
    .order("id", {
      ascending: true
    });

  if (error) {
    console.error(
      "Błąd pobierania obiektów z Supabase:",
      error
    );

    const counter =
      document.querySelector("#legend-counter");

    if (counter) {
      counter.textContent =
        "Nie udało się pobrać miejsc";
    }

    return;
  }

  console.log(
    "Rekordy pobrane z Supabase:",
    rows
  );

  data = supabaseRowsToGeoJson(rows || []);

  buildLegendaArray();
  buildPowiatArray();
  buildGminaArray();
  buildMiejscowoscArray();

  render();

  console.log(
    "Liczba opublikowanych obiektów:",
    data.features.length
  );
}

loadPublishedPlaces();

document.querySelectorAll('.filter-category, .filter-place, .filter-woj').forEach(input => {
  input.addEventListener('change', () => {
    updateToggleButtons();
    render();
  });
});

document.querySelectorAll('.toggle-section').forEach(button => {
  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();

    const targetClass = button.dataset.target;
    const inputs = document.querySelectorAll(`.${targetClass}`);
    const allChecked = [...inputs].every(input => input.checked);

    inputs.forEach(input => {
      input.checked = !allChecked;
    });

    updateToggleButtons();
    render();
  });
});

const periodFromInput = document.querySelector('#period-from');
const periodToInput = document.querySelector('#period-to');

function fixPeriodSliders(changedInput) {
  let from = Number(periodFromInput.value);
  let to = Number(periodToInput.value);

  if (from > to) {
    if (changedInput === periodFromInput) {
      periodFromInput.value = to;
    } else {
      periodToInput.value = from;
    }
  }
}

function updatePeriodSliderLayers(activeInput) {
  if (!periodFromInput || !periodToInput) return;

  periodFromInput.style.zIndex = '3';
  periodToInput.style.zIndex = '3';

  activeInput.style.zIndex = '5';
}

const periodSlider = document.querySelector('.period-slider');

if (periodSlider && periodFromInput && periodToInput) {
  periodSlider.addEventListener('pointerdown', event => {
    const from = Number(periodFromInput.value);
    const to = Number(periodToInput.value);

    if (from !== to) return;

    const rect = periodSlider.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const sliderWidth = rect.width;

    const thumbPosition = (from / 4) * sliderWidth;

    if (clickX <= thumbPosition) {
      updatePeriodSliderLayers(periodFromInput);
    } else {
      updatePeriodSliderLayers(periodToInput);
    }
  });
}

[periodFromInput, periodToInput].forEach(input => {
  if (!input) return;

  input.addEventListener('input', () => {
    updatePeriodSliderLayers(input);
    fixPeriodSliders(input);
    updatePeriodLabels();
    render();
  });
});

const showUnknownPeriodInput = document.querySelector('#show-unknown-period');

if (showUnknownPeriodInput) {
  showUnknownPeriodInput.addEventListener('change', render);
}

updatePeriodLabels();

const legendInput = document.querySelector('#legend-search');

if (legendInput) {

  legendInput.addEventListener('input', () => {
    showLegendaHint();
    render();
  });

  legendInput.addEventListener('keydown', event => {

    const hint = document.querySelector('#legend-hint');

    if ((event.key === 'Enter' || event.key === 'Tab') &&
      hint &&
      hint.style.display === 'block') {

      event.preventDefault();

      legendInput.value = hint.textContent;
      hint.style.display = 'none';

      render();
    }

  });

}

const clearLegend = document.querySelector('#clear-legend');

if (clearLegend && legendInput) {

  clearLegend.addEventListener('click', () => {

    legendInput.value = '';

    const hint = document.querySelector('#legend-hint');

    if (hint)
      hint.style.display = 'none';

    render();

  });

}

const zoomToResults = document.querySelector('#zoom-to-results');

if (zoomToResults) {
  zoomToResults.addEventListener('click', () => {
    if (layer && layer.getBounds && layer.getBounds().isValid()) {
      map.fitBounds(layer.getBounds(), {
        padding: [50, 50]
      });
    } else {
      alert('Brak widocznych miejsc dla wybranych filtrów.');
    }
  });
}

const powiatInput = document.querySelector('#powiat-search');

if (powiatInput) {
  powiatInput.addEventListener('input', () => {
    showPowiatHint();
    render();
  });

  powiatInput.addEventListener('keydown', event => {
    const hint = document.querySelector('#powiat-hint');

    if ((event.key === 'Enter' || event.key === 'Tab') && hint && hint.style.display === 'block') {
      event.preventDefault();
      powiatInput.value = hint.textContent;
      hint.style.display = 'none';
      render();
    }
  });
}

const clearPowiat = document.querySelector('#clear-powiat');

if (clearPowiat && powiatInput) {
  clearPowiat.addEventListener('click', () => {
    powiatInput.value = '';

    const hint = document.querySelector('#powiat-hint');
    if (hint) hint.style.display = 'none';

    render();
  });
}

const gminaInput = document.querySelector('#gmina-search');

if (gminaInput) {
  gminaInput.addEventListener('input', () => {
    showGminaHint();
    render();
  });

  gminaInput.addEventListener('keydown', event => {
    const hint = document.querySelector('#gmina-hint');

    if ((event.key === 'Enter' || event.key === 'Tab') && hint && hint.style.display === 'block') {
      event.preventDefault();
      gminaInput.value = hint.textContent;
      hint.style.display = 'none';
      render();
    }
  });
}

const clearGmina = document.querySelector('#clear-gmina');

if (clearGmina && gminaInput) {
  clearGmina.addEventListener('click', () => {
    gminaInput.value = '';

    const hint = document.querySelector('#gmina-hint');
    if (hint) hint.style.display = 'none';

    render();
  });
}

const miejscowoscInput = document.querySelector('#miejscowosc-search');

if (miejscowoscInput) {

  miejscowoscInput.addEventListener('input', () => {

    showMiejscowoscHint();

    render();

  });

  miejscowoscInput.addEventListener('keydown', event => {

    const hint = document.querySelector('#miejscowosc-hint');

    if ((event.key === "Enter" || event.key === "Tab")
      && hint
      && hint.style.display === "block") {

      event.preventDefault();

      miejscowoscInput.value = hint.textContent;

      hint.style.display = 'none';

      render();

    }

  });

}

const clearMiejscowosc = document.querySelector('#clear-miejscowosc');

if (clearMiejscowosc && miejscowoscInput) {

  clearMiejscowosc.addEventListener('click', () => {

    miejscowoscInput.value = '';

    const hint = document.querySelector('#miejscowosc-hint');

    if (hint)
      hint.style.display = 'none';

    render();

  });

}

updateToggleButtons();

const sidebar = document.querySelector('.sidebar');
const sidebarToggle = document.querySelector('#sidebar-toggle');

const legendCounter = document.querySelector('#legend-counter');
const topBar = document.querySelector('.top-bar');

if (!sidebar.classList.contains('hidden')) {
  legendCounter?.classList.add('sidebar-open');
  topBar?.classList.add('sidebar-open');
}
sidebarToggle.addEventListener('click', () => {

  sidebar.classList.toggle('hidden');
  document
    .querySelector('#legend-counter')
    ?.classList.toggle(
      'sidebar-open',
      !sidebar.classList.contains('hidden')
    );
  topBar?.classList.toggle(
    'sidebar-open',
    !sidebar.classList.contains('hidden')
  );
  sidebarToggle.classList.toggle('hidden');

  sidebarToggle.textContent =
    sidebar.classList.contains('hidden')
      ? '❯'
      : '❮';

  setTimeout(() => {
    map.invalidateSize();
  }, 300);

});

const baseLayers = {
  dark: darkOsmLayer,
  osm: osmLayer,
  topo: topoLayer,
  satellite: satelliteLayer
};

document.querySelectorAll('.basemap-btn').forEach(button => {

  button.addEventListener('click', () => {

    Object.values(baseLayers).forEach(layer => {

      if (map.hasLayer(layer))
        map.removeLayer(layer);

    });

    const selected = button.dataset.layer;

    baseLayers[selected].addTo(map);

    // Włącz/wyłącz ciemny filtr
    document.body.classList.remove('dark-map');

    if (selected === 'dark') {
      document.body.classList.add('dark-map');
    }

    document
      .querySelectorAll('.basemap-btn')
      .forEach(btn => btn.classList.remove('active'));

    button.classList.add('active');

  });

});

const basemapControl = document.querySelector('#basemap-control');
const basemapToggle = document.querySelector('#basemap-toggle');

if (basemapControl && basemapToggle) {
  basemapToggle.addEventListener('click', () => {
    basemapControl.classList.toggle('collapsed');

    basemapToggle.classList.toggle(
      'collapsed',
      basemapControl.classList.contains('collapsed')
    );
  });
}

// ==========================
// Przycisk "Home"
// ==========================


const zoomControl = document.querySelector('.leaflet-control-zoom');

if (zoomControl) {
  const homeButton = document.createElement('a');

  homeButton.className = 'leaflet-control-zoom-home';
  homeButton.href = '#';
  homeButton.title = 'Pokaż całą mapę';

  homeButton.innerHTML = `
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2.3"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M3 10.5L12 3l9 7.5"></path>
    <path d="M5 9.5V21h14V9.5"></path>
    <path d="M10 21v-6h4v6"></path>
  </svg>
`;

  homeButton.addEventListener('click', event => {
    event.preventDefault();

    map.flyTo(defaultCenter, defaultZoom, {
      duration: 0.3
    });
  });

  zoomControl.prepend(homeButton);
}

const locateControl = L.control({ position: 'bottomleft' });

locateControl.onAdd = function () {
  const button = L.DomUtil.create('button', 'locate-button');
  button.type = 'button';
  button.title = 'Pokaż moją lokalizację';

  button.innerHTML = `
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2.3"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <circle cx="12" cy="12" r="7"></circle>
    <path d="M12 2v3"></path>
    <path d="M12 19v3"></path>
    <path d="M2 12h3"></path>
    <path d="M19 12h3"></path>
    <circle cx="12" cy="12" r="2"></circle>
  </svg>
`;

  L.DomEvent.disableClickPropagation(button);

  button.addEventListener('click', () => {
    map.locate({
      setView: true,
      maxZoom: 15,
      enableHighAccuracy: true
    });
  });

  return button;
};

locateControl.addTo(map);

let userLocationMarker;
let userAccuracyCircle;

map.on('locationfound', event => {
  if (userLocationMarker) {
    map.removeLayer(userLocationMarker);
  }

  if (userAccuracyCircle) {
    map.removeLayer(userAccuracyCircle);
  }

  userLocationMarker = L.circleMarker(event.latlng, {
    radius: 8,
    color: '#d4af37',
    weight: 2,
    fillColor: '#1e90ff',
    fillOpacity: 0.9
  }).addTo(map);

  userAccuracyCircle = L.circle(event.latlng, {
    radius: event.accuracy,
    color: '#d4af37',
    weight: 1,
    fillOpacity: 0.08
  }).addTo(map);

  userLocationMarker.bindPopup('Twoja lokalizacja').openPopup();
});

map.on('locationerror', () => {
  alert('Nie udało się pobrać lokalizacji. Sprawdź zgodę w przeglądarce.');
});

const coordsControl = L.control({ position: 'bottomright' });

coordsControl.onAdd = function () {

  const div = L.DomUtil.create('div', 'coords-box');

  div.innerHTML = '-- , --';

  map.on('mousemove', e => {

    div.innerHTML = `N ${e.latlng.lat.toFixed(5)} | E ${e.latlng.lng.toFixed(5)} `;

  });

  return div;

};

coordsControl.addTo(map);

document
  .querySelector("#closePublicPhotoLightbox")
  ?.addEventListener(
    "click",
    closePublicPhotoLightbox
  );

document
  .querySelector("#publicPhotoPrevious")
  ?.addEventListener(
    "click",
    showPreviousPublicPhoto
  );

document
  .querySelector("#publicPhotoNext")
  ?.addEventListener(
    "click",
    showNextPublicPhoto
  );

document
  .querySelector("#publicPhotoLightbox")
  ?.addEventListener("click", event => {
    if (
      event.target ===
      document.querySelector("#publicPhotoLightbox")
    ) {
      closePublicPhotoLightbox();
    }
  });

document.addEventListener("keydown", event => {
  const lightbox =
    document.querySelector("#publicPhotoLightbox");

  const isOpen =
    lightbox &&
    !lightbox.classList.contains("hidden");

  if (!isOpen) return;

  if (event.key === "Escape") {
    closePublicPhotoLightbox();
  }

  if (event.key === "ArrowLeft") {
    showPreviousPublicPhoto();
  }

  if (event.key === "ArrowRight") {
    showNextPublicPhoto();
  }
});