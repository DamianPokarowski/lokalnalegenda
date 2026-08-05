const SUPABASE_URL =
  "https://aywbgpsgihbginuyuxpn.supabase.co";

const SUPABASE_ANON_KEY =
  "sb_publishable_gKk-hEOT-RC7M1xkJQU7uA_0VJz8-pF";

const supabaseClient = supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

const categories = [
  "Lokalna legenda",
  "Nawiedzone miejsce",
  "Opuszczony obiekt",
  "Tragiczne wydarzenie",
  "Obserwacja UFO",
  "Kryptozoologia",
  "Niewyjaśnione zjawisko"
];

let records = []

function normalizeRecordSchema(record) {
  const sourceParts = String(record.source || "").split(" — ");
  const normalizedPeriodType =
    record.periodType === "dokladny" ? "dokładna data" :
      record.periodType === "ogolny" ? "ogólny okres" :
        record.periodType || "nieznany";

  return {
    ...record,
    typePlace: record.typePlace || "inne",
    sourceType: record.sourceType || sourceParts[0] || "inne",
    sourcePerson: record.sourcePerson || sourceParts[1] || "",
    periodType: normalizedPeriodType,
    exactDate: record.exactDate || (normalizedPeriodType === "dokładna data" ? record.period : ""),
    generalPeriod: record.generalPeriod || (normalizedPeriodType === "ogólny okres" ? record.period : ""),
    photos: Array.isArray(record.photos) ? record.photos : []
  };
}

function databaseRowToRecord(row) {
  const period =
    row.typ_okresu === "dokładna data"
      ? row.dokladna_data
      : row.typ_okresu === "ogólny okres"
        ? row.ogolny_okres
        : "Nieznany";

  return normalizeRecordSchema({
    id: row.id,

    status: databaseStatusToPanel(row.status),

    name: row.nazwa || "",
    category: categoryDatabaseToPanel(row.kategoria),
    description: row.opis || "",
    typePlace: row.typ_miejsca || "",
    accuracy: accuracyDatabaseToPanel(
      row.dokladnosc_miejsca
    ),

    place: row.miejscowosc || "",
    commune: row.gmina || "",
    county: row.powiat || "",
    voivodeship: row.wojewodztwo || "",

    sourceType: row.typ_zrodla || "",
    sourcePerson: row.osoba_przekazujaca || "",

    source: [
      row.typ_zrodla,
      row.osoba_przekazujaca
    ].filter(Boolean).join(" — "),

    periodType: row.typ_okresu || "nieznany",
    exactDate: row.dokladna_data || "",
    generalPeriod: row.ogolny_okres || "",
    period,

    lat: Number(row.lat),
    lng: Number(row.lng),

    duplicateWarningDismissedKey:
      row.duplikat_sprawdzony_dla || null,

    photos: Array.isArray(row.zdjecia)
      ? row.zdjecia.map(photo => ({
        id: photo.id,
        path: photo.sciezka,
        url: photo.url,
        caption: photo.podpis || "",
        createdAt: photo.data_dodania || null
      }))
      : []
  });
}

function recordToDatabaseRow(record) {
  return {
    nazwa: record.name,
    kategoria: String(record.category).toLowerCase(),
    opis: record.description,

    typ_miejsca: record.typePlace,

    dokladnosc_miejsca:
      accuracyPanelToDatabase(record.accuracy),

    miejscowosc: record.place || null,
    gmina: record.commune || null,
    powiat: record.county || null,
    wojewodztwo: record.voivodeship || null,

    typ_zrodla: record.sourceType,

    osoba_przekazujaca:
      record.sourceType === "przekaz ustny"
        ? record.sourcePerson || null
        : null,

    typ_okresu: record.periodType,

    dokladna_data:
      record.periodType === "dokładna data"
        ? record.exactDate || null
        : null,

    ogolny_okres:
      record.periodType === "ogólny okres"
        ? record.generalPeriod || null
        : null,

    lat: Number(record.lat),
    lng: Number(record.lng),

    status: panelStatusToDatabase(record.status),

    duplikat_sprawdzony_dla:
      record.duplicateWarningDismissedKey || null
  };
}

function databaseStatusToPanel(status) {
  return {
    oczekuje: "do_weryfikacji",
    do_weryfikacji: "do_weryfikacji",
    opublikowany: "opublikowany",
    odrzucony: "odrzucony"
  }[status] || "do_weryfikacji";
}

function panelStatusToDatabase(status) {
  return {
    do_weryfikacji: "oczekuje",
    oczekuje: "oczekuje",
    opublikowany: "opublikowany",
    odrzucony: "odrzucony"
  }[status] || "oczekuje";
}

function accuracyDatabaseToPanel(value) {
  return {
    dokładna: "Dokładna ≤10 m",
    przybliżona: "Przybliżona 10–50 m",
    orientacyjna: "Orientacyjna 50–200 m",
    ogólna: "Ogólna >200 m"
  }[value] || value || "";
}

function accuracyPanelToDatabase(value) {
  return {
    "Dokładna ≤10 m": "dokładna",
    "Przybliżona 10–50 m": "przybliżona",
    "Orientacyjna 50–200 m": "orientacyjna",
    "Ogólna >200 m": "ogólna"
  }[value] || value;
}

function categoryDatabaseToPanel(value) {
  const category = categories.find(
    item => item.toLowerCase() === String(value || "").toLowerCase()
  );

  return category || value || "";
}

let currentRecordId = null;
let map;
let marker;
let editorObjectsLayer;
let addMap;
let addMarker;
let addObjectsLayer;
let pendingSave = null;
let addPhotoPreviewUrls = [];
let pendingPhotoDeletes = new Set();
let pendingPhotoReplacements = new Map();
let pendingNewPhotoFiles = [];

const el = id => document.getElementById(id);

const grayMarkerIcon = L.divIcon({
  className: "gray-object-marker",
  html: `
    <svg viewBox="0 0 32 45" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M16 1C8.3 1 2 7.3 2 15c0 10.5 14 28 14 28s14-17.5 14-28C30 7.3 23.7 1 16 1z"
        fill="#777"
        stroke="#d0d0d0"
        stroke-width="2"
      />
      <circle cx="16" cy="15" r="5" fill="#303030"/>
    </svg>
  `,
  iconSize: [32, 45],
  iconAnchor: [16, 43],
  popupAnchor: [0, -42]
});

const redMarkerIcon = L.divIcon({
  className: "red-object-marker",
  html: `
    <svg viewBox="0 0 32 45" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M16 1C8.3 1 2 7.3 2 15c0 10.5 14 28 14 28s14-17.5 14-28C30 7.3 23.7 1 16 1z"
        fill="#b83232"
        stroke="#ffd0d0"
        stroke-width="2"
      />
      <circle cx="16" cy="15" r="5" fill="#3a0d0d"/>
    </svg>
  `,
  iconSize: [32, 45],
  iconAnchor: [16, 43],
  popupAnchor: [0, -42]
});

function statusLabel(status) {
  return {
    do_weryfikacji: "Do weryfikacji",
    opublikowany: "Opublikowany",
    odrzucony: "Odrzucony"
  }[status] || status;
}

function showToast(message) {
  el("toast").textContent = message;
  el("toast").classList.remove("hidden");
  setTimeout(() => el("toast").classList.add("hidden"), 2600);
}

function switchView(view, status = null) {
  el("dashboardView").classList.toggle("hidden", view !== "dashboard");
  el("recordsView").classList.toggle("hidden", view !== "records");

  document.querySelectorAll(".nav-btn[data-view]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });

  if (view === "dashboard") {
    el("pageTitle").textContent = "Pulpit";
    el("pageSubtitle").textContent = "Podsumowanie obiektów w bazie";
  } else {
    el("pageTitle").textContent = "Obiekty";
    el("pageSubtitle").textContent = "Weryfikacja, publikowanie i edycja rekordów";
    if (status) el("statusFilter").value = status;
    renderTable();
  }
}

function updateStats() {
  el("countPending").textContent = records.filter(r => r.status === "do_weryfikacji").length;
  el("countPublished").textContent = records.filter(r => r.status === "opublikowany").length;
  el("countRejected").textContent = records.filter(r => r.status === "odrzucony").length;

  const recent = records.filter(r => r.status === "do_weryfikacji").slice(0, 5);
  el("recentRecords").innerHTML = recent.length ? recent.map(r => `
    <button class="recent-item" data-id="${r.id}">
      <strong>${escapeHtml(r.name)}</strong>
      <span>${escapeHtml(r.category)}</span>
      <span>${escapeHtml(r.place)}</span>
      <span>${escapeHtml(r.period)}</span>
    </button>
  `).join("") : `<div style="padding:22px;color:#999">Brak obiektów do weryfikacji.</div>`;

  document.querySelectorAll(".recent-item").forEach(btn =>
    btn.addEventListener("click", () => openEditor(Number(btn.dataset.id)))
  );
}

function distanceMeters(a, b) {
  const R = 6371000;
  const p1 = a.lat * Math.PI / 180;
  const p2 = b.lat * Math.PI / 180;
  const dp = (b.lat - a.lat) * Math.PI / 180;
  const dl = (b.lng - a.lng) * Math.PI / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function duplicateCheckKey(record) {
  const name = String(record.name || "")
    .trim()
    .toLowerCase();

  const lat = Number(record.lat);
  const lng = Number(record.lng);

  return [
    name,
    Number.isFinite(lat) ? lat.toFixed(5) : "",
    Number.isFinite(lng) ? lng.toFixed(5) : ""
  ].join("|");
}

function isDuplicateWarningDismissed(record) {
  return (
    record.duplicateWarningDismissedKey &&
    record.duplicateWarningDismissedKey === duplicateCheckKey(record)
  );
}

function getPotentialDuplicates(record) {
  if (!record) return [];
  return records
    .filter(r => r.id !== record.id)
    .map(r => ({ record: r, distance: distanceMeters(record, r) }))
    .filter(item =>
      item.distance <= 1000 &&
      (
        item.distance < 30 ||
        item.record.name.toLowerCase() === record.name.toLowerCase()
      )
    )
    .sort((a, b) => a.distance - b.distance);
}

function renderOtherObjects(
  targetMap,
  targetLayer,
  excludedId = null,
  highlightedIds = []
) {
  if (!targetMap) {
    return targetLayer;
  }

  if (targetLayer && targetMap.hasLayer(targetLayer)) {
    targetMap.removeLayer(targetLayer);
  }

  const containerLayer = L.layerGroup().addTo(targetMap);

  const clusterLayer = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 45,
    spiderfyOnMaxZoom: true,
    disableClusteringAtZoom: 15,
    removeOutsideVisibleBounds: true
  });

  const highlightedLayer = L.layerGroup();

  clusterLayer.addTo(containerLayer);
  highlightedLayer.addTo(containerLayer);

  const highlightedSet = new Set(highlightedIds);

  records.forEach(record => {
    if (record.id === excludedId) {
      return;
    }

    const lat = Number(record.lat);
    const lng = Number(record.lng);

    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      return;
    }

    const isDuplicate = highlightedSet.has(record.id);

    const otherMarker = L.marker(
      [lat, lng],
      {
        icon: isDuplicate
          ? redMarkerIcon
          : grayMarkerIcon,

        interactive: true,
        keyboard: false,

        zIndexOffset: isDuplicate
          ? 800
          : 0
      }
    );

    otherMarker.bindPopup(`
      <div class="admin-other-object-popup">
        ${
          isDuplicate
            ? `
              <strong class="duplicate-popup-title">
                ⚠ Potencjalny duplikat
              </strong>
            `
            : ""
        }

        <strong>${escapeHtml(record.name)}</strong>
        <span>${escapeHtml(record.category)}</span>
        <span>${escapeHtml(record.place || "")}</span>
        <span>
          Status: ${escapeHtml(statusLabel(record.status))}
        </span>
      </div>
    `);

    /*
      Zwykłe obiekty trafiają do klastrów.
      Czerwone potencjalne duplikaty pozostają osobno,
      żeby nie zostały ukryte wewnątrz klastra.
    */
    if (isDuplicate) {
      otherMarker.addTo(highlightedLayer);
    } else {
      otherMarker.addTo(clusterLayer);
    }
  });

  return containerLayer;
}

function filteredRecords() {
  const status = el("statusFilter").value;
  const category = el("categoryFilter").value;
  const search = el("searchInput").value.trim().toLowerCase();

  return records.filter(r => {
    const matchesStatus = status === "all" || r.status === status;
    const matchesCategory = category === "all" || r.category === category;
    const haystack = `${r.name} ${r.category} ${r.voivodeship} ${r.county} ${r.commune} ${r.place}`.toLowerCase();
    const matchesSearch = !search || haystack.includes(search);
    return matchesStatus && matchesCategory && matchesSearch;
  });
}

function renderTable() {
  const data = filteredRecords();
  el("recordCount").textContent = `${data.length} ${data.length === 1 ? "obiekt" : "obiektów"}`;

  el("recordsBody").innerHTML = data.map(r => {
    const dupes = isDuplicateWarningDismissed(r)
      ? []
      : getPotentialDuplicates(r);
    return `
      <tr data-id="${r.id}">
        <td>${r.id}</td>
        <td><span class="status-badge status-${r.status}">${statusLabel(r.status)}</span></td>
        <td title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</td>
        <td>${escapeHtml(r.category)}</td>
        <td>${escapeHtml(r.period)}</td>
        <td>${escapeHtml(r.voivodeship)}</td>
        <td>${escapeHtml(r.county)}</td>
        <td>${escapeHtml(r.commune)}</td>
        <td>${escapeHtml(r.place)}</td>
        <td>${escapeHtml(r.accuracy)}</td>
        <td class="${dupes.length ? "duplicate-cell" : ""}">${dupes.length ? `⚠ ${dupes.length}` : "—"}</td>
      </tr>
    `;
  }).join("");

  document.querySelectorAll("#recordsBody tr").forEach(row =>
    row.addEventListener("click", () => openEditor(Number(row.dataset.id)))
  );
}

async function compressAdminImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const reader = new FileReader();

    reader.onerror = () => {
      reject(new Error("Nie udało się odczytać zdjęcia."));
    };

    reader.onload = event => {
      image.src = event.target.result;
    };

    image.onerror = () => {
      reject(new Error("Wybrany plik nie jest prawidłowym zdjęciem."));
    };

    image.onload = () => {
      const maxWidth = 1400;
      const maxHeight = 1400;

      let width = image.width;
      let height = image.height;

      if (width > height && width > maxWidth) {
        height = Math.round(height * maxWidth / width);
        width = maxWidth;
      } else if (height > maxHeight) {
        width = Math.round(width * maxHeight / height);
        height = maxHeight;
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const context = canvas.getContext("2d");

      if (!context) {
        reject(new Error("Nie udało się przygotować zdjęcia."));
        return;
      }

      context.drawImage(image, 0, 0, width, height);

      canvas.toBlob(
        blob => {
          if (!blob) {
            reject(new Error("Nie udało się skompresować zdjęcia."));
            return;
          }

          const outputName =
            file.name.replace(/\.[^/.]+$/, "") + ".jpg";

          resolve(
            new File([blob], outputName, {
              type: "image/jpeg"
            })
          );
        },
        "image/jpeg",
        0.75
      );
    };

    reader.readAsDataURL(file);
  });
}

async function uploadAdminPhotos(zgloszenieId, files) {
  const selectedFiles = [...files].slice(0, 3);

  if (!selectedFiles.length) {
    return [];
  }

  const {
    data: { user },
    error: userError
  } = await supabaseClient.auth.getUser();

  if (userError) {
    throw userError;
  }

  if (!user?.id) {
    throw new Error("Brak aktywnej sesji administratora.");
  }

  const uploadedPhotos = [];

  for (const file of selectedFiles) {
    const compressed = await compressAdminImage(file);

    const safeName = compressed.name
      .toLowerCase()
      .replaceAll(" ", "_")
      .replace(/[^a-z0-9._-]/g, "");

    const filePath =
      `${user.id}/zgloszenie_${zgloszenieId}/${Date.now()}_${safeName}`;

    const { error: uploadError } = await supabaseClient
      .storage
      .from("zdjecia")
      .upload(filePath, compressed, {
        contentType: compressed.type,
        upsert: false
      });

    if (uploadError) {
      throw uploadError;
    }

    const { data: publicData } = supabaseClient
      .storage
      .from("zdjecia")
      .getPublicUrl(filePath);

    const { data: photoRow, error: photoError } =
      await supabaseClient
        .from("zdjecia")
        .insert({
          zgloszenie_id: zgloszenieId,
          sciezka: filePath,
          url: publicData.publicUrl,
          submitted_by: user.id
        })
        .select(`
          id,
          sciezka,
          url,
          podpis,
          data_dodania
        `)
        .single();

    if (photoError) {
      await supabaseClient
        .storage
        .from("zdjecia")
        .remove([filePath]);

      throw photoError;
    }

    uploadedPhotos.push(photoRow);
  }

  return uploadedPhotos;
}

async function deletePhotosForSubmission(zgloszenieId) {
  const { data: photoRows, error: readError } =
    await supabaseClient
      .from("zdjecia")
      .select("id, sciezka")
      .eq("zgloszenie_id", zgloszenieId);

  if (readError) {
    throw readError;
  }

  const paths = (photoRows || [])
    .map(photo => photo.sciezka)
    .filter(Boolean);

  if (paths.length) {
    const { error: storageError } = await supabaseClient
      .storage
      .from("zdjecia")
      .remove(paths);

    if (storageError) {
      throw storageError;
    }
  }

  const { error: deleteRowsError } = await supabaseClient
    .from("zdjecia")
    .delete()
    .eq("zgloszenie_id", zgloszenieId);

  if (deleteRowsError) {
    throw deleteRowsError;
  }
}

async function deleteSinglePhoto(photo) {
  if (!photo?.id) {
    return;
  }

  if (photo.path) {
    const { error: storageError } = await supabaseClient
      .storage
      .from("zdjecia")
      .remove([photo.path]);

    if (storageError) {
      throw storageError;
    }
  }

  const { error: databaseError } = await supabaseClient
    .from("zdjecia")
    .delete()
    .eq("id", photo.id);

  if (databaseError) {
    throw databaseError;
  }
}

function initSelects() {
  el("categoryFilter").innerHTML += categories.map(c => `<option>${c}</option>`).join("");
}

function initMap() {
  map = L.map("editorMap", { zoomControl: true }).setView([51.9, 19.1], 6);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap"
  }).addTo(map);

  marker = L.marker([51.9, 19.1], { draggable: true }).addTo(map);

  marker.on("dragend", async () => {
    const pos = marker.getLatLng();
    el("editLat").value = pos.lat.toFixed(6);
    el("editLng").value = pos.lng.toFixed(6);
    await editorReverseGeocode(pos.lat, pos.lng);
    refreshDuplicateAlertFromForm();
  });

  map.on("click", async event => {
    marker.setLatLng(event.latlng);
    el("editLat").value = event.latlng.lat.toFixed(6);
    el("editLng").value = event.latlng.lng.toFixed(6);
    await editorReverseGeocode(event.latlng.lat, event.latlng.lng);
    refreshDuplicateAlertFromForm();
  });
}

function recordFromForm() {
  const periodType = el("editPeriodType").value;
  const exactDate = el("editExactDate").value;
  const generalPeriod = el("editGeneralPeriod").value;
  const period =
    periodType === "dokładna data" ? exactDate :
      periodType === "ogólny okres" ? generalPeriod :
        "Nieznany";

  const sourceType = el("editSourceType").value;
  const sourcePerson = el("editPerson").value;
  const source = [sourceType, sourcePerson].filter(Boolean).join(" — ");

  const existing = records.find(r => r.id === currentRecordId);

  return {
    ...(existing || {}),
    id: currentRecordId ?? Math.max(0, ...records.map(r => r.id)) + 1,
    status: el("editStatus").value,
    name: el("editName").value.trim(),
    category: el("editCategory").value,
    description: el("editDescription").value.trim(),
    typePlace: el("editTypePlace").value,
    accuracy: el("editAccuracy").value,
    place: el("editPlace").value.trim(),
    commune: el("editCommune").value.trim(),
    county: el("editCounty").value.trim(),
    voivodeship: el("editVoivodeship").value.trim(),
    sourceType,
    sourcePerson: sourceType === "przekaz ustny" ? sourcePerson : "",
    source,
    periodType,
    exactDate: periodType === "dokładna data" ? exactDate : "",
    generalPeriod: periodType === "ogólny okres" ? generalPeriod : "",
    period,
    photos: existing?.photos || [],
    lat: Number(el("editLat").value),
    lng: Number(el("editLng").value)
  };
}

function refreshDuplicateAlertFromForm() {
  const draft = recordFromForm();

  const warningDismissed =
    isDuplicateWarningDismissed(draft);

  const duplicates = warningDismissed
    ? []
    : getPotentialDuplicates(draft);

  const alert = el("duplicateAlert");

  editorObjectsLayer = renderOtherObjects(
    map,
    editorObjectsLayer,
    currentRecordId,
    duplicates.map(item => item.record.id)
  );

  if (!duplicates.length) {
    alert.classList.add("hidden");
    alert.innerHTML = "";
    return;
  }

  alert.innerHTML = `
    <div class="duplicate-alert-content">
      <div>
        <strong>⚠ Potencjalny duplikat</strong>

        <div class="duplicate-alert-list">
          ${duplicates.map(item => `
            <span>
              ${escapeHtml(item.record.name)}
              — około ${Math.round(item.distance)} m
            </span>
          `).join("")}
        </div>
      </div>

      <button
        type="button"
        id="dismissDuplicateWarning"
        class="dismiss-duplicate-btn"
      >
        Oznacz jako sprawdzone
      </button>
    </div>
  `;

  alert.classList.remove("hidden");

  el("dismissDuplicateWarning")
    .addEventListener("click", dismissDuplicateWarning);
}

async function dismissDuplicateWarning() {
  if (currentRecordId === null) return;

  const record = records.find(
    item => item.id === currentRecordId
  );

  if (!record) return;

  const currentFormRecord = recordFromForm();

  const duplicateKey =
    duplicateCheckKey(currentFormRecord);

  try {
    const { error } = await supabaseClient
      .from("zgloszenia")
      .update({
        duplikat_sprawdzony_dla: duplicateKey
      })
      .eq("id", currentRecordId);

    if (error) {
      throw error;
    }

    record.duplicateWarningDismissedKey =
      duplicateKey;

    el("duplicateAlert").classList.add("hidden");
    el("duplicateAlert").innerHTML = "";

    editorObjectsLayer = renderOtherObjects(
      map,
      editorObjectsLayer,
      currentRecordId,
      []
    );

    renderTable();

    showToast(
      "Ostrzeżenie o duplikacie zostało oznaczone jako sprawdzone."
    );
  } catch (error) {
    console.error(error);

    showToast(
      "Nie udało się zapisać sprawdzenia duplikatu."
    );
  }
}

function updateEditConditionalFields() {
  const sourceType = el("editSourceType").value;
  const periodType = el("editPeriodType").value;

  el("editPersonWrapper").classList.toggle("hidden", sourceType !== "przekaz ustny");
  if (sourceType !== "przekaz ustny") el("editPerson").value = "";

  el("editExactDateWrapper").classList.toggle("hidden", periodType !== "dokładna data");
  el("editGeneralPeriodWrapper").classList.toggle("hidden", periodType !== "ogólny okres");

  if (periodType !== "dokładna data") el("editExactDate").value = "";
  if (periodType !== "ogólny okres") el("editGeneralPeriod").value = "";
}

function openPhotoLightbox(url, caption = "") {
  const lightbox = el("photoLightbox");
  const image = el("photoLightboxImage");
  const captionElement = el("photoLightboxCaption");

  if (!lightbox || !image || !url) {
    return;
  }

  image.src = url;
  image.alt = caption || "Podgląd zdjęcia";

  if (captionElement) {
    captionElement.textContent = caption;
  }

  lightbox.classList.remove("hidden");
  lightbox.setAttribute("aria-hidden", "false");

  document.body.classList.add("photo-lightbox-open");
}

function closePhotoLightbox() {
  const lightbox = el("photoLightbox");
  const image = el("photoLightboxImage");

  if (!lightbox || !image) {
    return;
  }

  lightbox.classList.add("hidden");
  lightbox.setAttribute("aria-hidden", "true");

  image.src = "";

  document.body.classList.remove("photo-lightbox-open");
}

function renderEditPhotos(record) {
  const preview = el("editPhotoPreview");
  preview.innerHTML = "";

  const existingPhotos = Array.isArray(record.photos)
    ? record.photos
    : [];

  const visibleExistingPhotos = existingPhotos.filter(
    photo => !pendingPhotoDeletes.has(photo.id)
  );

  if (
    visibleExistingPhotos.length === 0 &&
    pendingNewPhotoFiles.length === 0
  ) {
    preview.innerHTML =
      `<p class="hint">Brak zdjęć przypisanych do tego obiektu.</p>`;
    return;
  }

  visibleExistingPhotos.forEach((photo, index) => {
    const replacement =
      pendingPhotoReplacements.get(photo.id);

    const displayedUrl =
      replacement?.previewUrl || photo.url;

    const wrapper = document.createElement("div");
    wrapper.className = "admin-photo-item";

    const img = document.createElement("img");
    img.src = displayedUrl;
    img.alt = photo.caption || `Zdjęcie ${index + 1}`;
    img.loading = "lazy";

    img.addEventListener("click", () => {
      openPhotoLightbox(
        displayedUrl,
        replacement
          ? "Nowe zdjęcie — oczekuje na zapis"
          : photo.caption || `Zdjęcie ${index + 1}`
      );
    });

    const actions = document.createElement("div");
    actions.className = "admin-photo-actions";

    const replaceButton = document.createElement("button");
    replaceButton.type = "button";
    replaceButton.className = "photo-replace-btn";
    replaceButton.textContent = replacement
      ? "Zmień ponownie"
      : "Zastąp";

    const replacementInput =
      document.createElement("input");

    replacementInput.type = "file";
    replacementInput.accept =
      "image/jpeg,image/png,image/webp";

    replacementInput.hidden = true;

    replaceButton.addEventListener("click", event => {
      event.stopPropagation();
      replacementInput.click();
    });

    replacementInput.addEventListener("change", () => {
      const file = replacementInput.files?.[0];

      if (!file) {
        return;
      }

      const previousReplacement =
        pendingPhotoReplacements.get(photo.id);

      if (previousReplacement?.previewUrl) {
        URL.revokeObjectURL(
          previousReplacement.previewUrl
        );
      }

      pendingPhotoReplacements.set(photo.id, {
        file,
        previewUrl: URL.createObjectURL(file)
      });

      renderEditPhotos(record);
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "photo-delete-btn";
    deleteButton.textContent = "Usuń";

    deleteButton.addEventListener("click", event => {
      event.stopPropagation();

      const replacement =
        pendingPhotoReplacements.get(photo.id);

      if (replacement?.previewUrl) {
        URL.revokeObjectURL(replacement.previewUrl);
      }

      pendingPhotoReplacements.delete(photo.id);
      pendingPhotoDeletes.add(photo.id);

      renderEditPhotos(record);
    });

    actions.appendChild(replaceButton);
    actions.appendChild(deleteButton);

    wrapper.appendChild(img);
    wrapper.appendChild(actions);
    wrapper.appendChild(replacementInput);

    if (replacement) {
      const replacementLabel =
        document.createElement("span");

      replacementLabel.className =
        "photo-change-label";

      replacementLabel.textContent =
        "Zdjęcie zostanie zastąpione";

      wrapper.appendChild(replacementLabel);
    }

    preview.appendChild(wrapper);
  });

  pendingNewPhotoFiles.forEach((file, index) => {
    const wrapper = document.createElement("div");
    wrapper.className =
      "admin-photo-item admin-photo-new";

    const img = document.createElement("img");
    img.src = file.previewUrl;
    img.alt = file.file.name;

    img.addEventListener("click", () => {
      openPhotoLightbox(
        file.previewUrl,
        "Nowe zdjęcie — oczekuje na zapis"
      );
    });

    const actions = document.createElement("div");
    actions.className = "admin-photo-actions";

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "photo-delete-btn";
    removeButton.textContent = "Usuń";

    removeButton.addEventListener("click", event => {
      event.stopPropagation();

      URL.revokeObjectURL(file.previewUrl);
      pendingNewPhotoFiles.splice(index, 1);

      renderEditPhotos(record);
    });

    const label = document.createElement("span");
    label.className = "photo-change-label";
    label.textContent = "Nowe zdjęcie";

    actions.appendChild(removeButton);

    wrapper.appendChild(img);
    wrapper.appendChild(actions);
    wrapper.appendChild(label);

    preview.appendChild(wrapper);
  });
}

async function editorReverseGeocode(lat, lng) {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=pl`
    );
    const json = await response.json();
    const a = json.address || {};

    el("editPlace").value = a.city || a.town || a.village || a.hamlet || "";
    el("editCommune").value = cleanAdminName(a.municipality || a.county || "");
    el("editCounty").value = cleanAdminName(a.county || "");
    el("editVoivodeship").value = cleanAdminName(a.state || "");
  } catch (error) {
    el("editFormMessage").textContent = "Nie udało się automatycznie pobrać danych administracyjnych.";
  }
}

function clearPendingPhotoChanges() {
  pendingPhotoReplacements.forEach(replacement => {
    if (replacement.previewUrl) {
      URL.revokeObjectURL(replacement.previewUrl);
    }
  });

  pendingPhotoReplacements.clear();

  pendingNewPhotoFiles.forEach(photo => {
    if (photo.previewUrl) {
      URL.revokeObjectURL(photo.previewUrl);
    }
  });

  pendingNewPhotoFiles = [];
  pendingPhotoDeletes.clear();

  const input = el("editPhotos");

  if (input) {
    input.value = "";
  }
}

function openEditor(id) {
  clearPendingPhotoChanges();
  currentRecordId = id;

  const r = normalizeRecordSchema(records.find(item => item.id === id));

  el("editorTitle").textContent = r.name;
  el("editStatus").value = r.status;
  el("editName").value = r.name;
  el("editCategory").value = r.category;
  el("editDescription").value = r.description;
  el("editTypePlace").value = r.typePlace;
  el("editAccuracy").value = r.accuracy;
  el("editPlace").value = r.place;
  el("editCommune").value = r.commune;
  el("editCounty").value = r.county;
  el("editVoivodeship").value = r.voivodeship;
  el("editSourceType").value = r.sourceType;
  el("editPerson").value = r.sourcePerson;
  el("editPeriodType").value = r.periodType;
  el("editExactDate").value = r.exactDate;
  el("editGeneralPeriod").value = r.generalPeriod;
  el("editLat").value = r.lat;
  el("editLng").value = r.lng;
  el("editPhotos").value = "";
  el("editFormMessage").textContent = "";

  updateEditConditionalFields();
  renderEditPhotos(r);
  el("deleteRecord").classList.remove("hidden");
  el("editorOverlay").classList.remove("hidden");

  setTimeout(() => {
    map.invalidateSize();

    marker.setLatLng([r.lat, r.lng]);
    marker.setZIndexOffset(1000);

    map.setView([r.lat, r.lng], 15);

    refreshDuplicateAlertFromForm();
  }, 50);
}

function closeEditor() {
  closePhotoLightbox();
  clearPendingPhotoChanges();

  el("editorOverlay").classList.add("hidden");
  currentRecordId = null;
}

function validateRecord(r) {
  if (!r.name) return "Nazwa obiektu jest wymagana.";
  if (!r.category) return "Wybierz kategorię.";
  if (!r.description) return "Opis jest wymagany.";
  if (!r.typePlace) return "Wybierz typ miejsca.";
  if (!r.accuracy) return "Wybierz dokładność lokalizacji.";
  if (!r.sourceType) return "Wybierz typ źródła.";
  if (r.sourceType === "przekaz ustny" && !r.sourcePerson) return "Wybierz osobę przekazującą.";
  if (!r.periodType) return "Wybierz typ okresu.";
  if (r.periodType === "dokładna data" && !r.exactDate) return "Wybierz dokładną datę.";
  if (r.periodType === "ogólny okres" && !r.generalPeriod) return "Wybierz ogólny okres.";
  if (!Number.isFinite(r.lat) || !Number.isFinite(r.lng)) return "Współrzędne są nieprawidłowe.";
  return null;
}

function requestSave() {
  const draft = recordFromForm();
  const error = validateRecord(draft);
  if (error) return showToast(error);

  const existing = records.find(r => r.id === currentRecordId);
  const publishingNow = draft.status === "opublikowany" && (!existing || existing.status !== "opublikowany");

  if (publishingNow) {
    pendingSave = draft;
    el("confirmTitle").textContent = "Czy na pewno opublikować obiekt?";
    el("confirmText").textContent = "Po zapisaniu obiekt będzie widoczny na publicznej mapie.";
    el("acceptConfirm").textContent = "Opublikuj";
    el("confirmOverlay").classList.remove("hidden");
  } else {
    commitSave(draft);
  }
}

async function commitSave(draft) {
  try {
    const databaseRow = recordToDatabaseRow(draft);

    const { error } = await supabaseClient
      .from("zgloszenia")
      .update(databaseRow)
      .eq("id", draft.id);

    if (error) {
      throw error;
    }

    const existingRecord = records.find(
      record => record.id === draft.id
    );

    const existingPhotos =
      existingRecord?.photos || [];

    for (
      const [photoId, replacement]
      of pendingPhotoReplacements.entries()
    ) {
      const oldPhoto = existingPhotos.find(
        photo => Number(photo.id) === Number(photoId)
      );

      if (!oldPhoto) {
        continue;
      }

      await uploadAdminPhotos(
        draft.id,
        [replacement.file]
      );

      await deleteSinglePhoto(oldPhoto);
    }

    for (const photoId of pendingPhotoDeletes) {
      const photo = existingPhotos.find(
        item => Number(item.id) === Number(photoId)
      );

      if (!photo) {
        continue;
      }

      await deleteSinglePhoto(photo);
    }

    if (pendingNewPhotoFiles.length) {
      await uploadAdminPhotos(
        draft.id,
        pendingNewPhotoFiles.map(item => item.file)
      );
    }

    await loadRecordsFromSupabase();

    pendingSave = null;
    el("confirmOverlay").classList.add("hidden");

    closeEditor();

    updateStats();
    renderTable();

    if (addMap) {
      addObjectsLayer = renderOtherObjects(
        addMap,
        addObjectsLayer
      );
    }

    showToast("Zmiany zostały zapisane w bazie.");
  } catch (error) {
    console.error(error);

    showToast(
      "Nie udało się zapisać zmian: " +
      (error.message || "nieznany błąd")
    );
  }
}

function deleteCurrentRecord() {
  if (currentRecordId === null) return;
  const r = records.find(item => item.id === currentRecordId);
  el("confirmTitle").textContent = "Czy na pewno usunąć rekord?";
  el("confirmText").textContent = `Usunięty zostanie obiekt „${r.name}”. W wersji docelowej zalecane będzie usuwanie logiczne.`;
  el("acceptConfirm").textContent = "Usuń";
  pendingSave = { deleteId: currentRecordId };
  el("confirmOverlay").classList.remove("hidden");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function openAdminPanel() {
  console.log("Otwieranie panelu administratora...");

  await loadRecordsFromSupabase();

  console.log("Liczba pobranych rekordów:", records.length);

  el("loginView").classList.add("hidden");
  el("appView").classList.remove("hidden");

  updateStats();
  renderTable();

  if (addMap) {
    addObjectsLayer = renderOtherObjects(
      addMap,
      addObjectsLayer
    );
  }
}

el("loginForm").addEventListener("submit", async event => {
  event.preventDefault();

  const email = el("loginEmail").value.trim();
  const password = el("loginPassword").value;
  const message = el("loginMessage");
  const button = event.submitter;

  message.textContent = "";
  button.disabled = true;
  button.textContent = "Logowanie...";

  try {
    const { data, error } =
      await supabaseClient.auth.signInWithPassword({
        email,
        password
      });

    if (error) {
      throw error;
    }

    const { data: adminRecord, error: adminError } =
      await supabaseClient
        .from("administratorzy")
        .select("user_id, email")
        .eq("user_id", data.user.id)
        .maybeSingle();

    if (adminError) {
      throw adminError;
    }

    if (!adminRecord) {
      await supabaseClient.auth.signOut();
      throw new Error(
        "To konto nie ma uprawnień administratora."
      );
    }

    console.log(
      "Administrator zweryfikowany:",
      adminRecord
    );

    await openAdminPanel();
  } catch (error) {
    console.error(error);

    message.textContent =
      error.message === "Invalid login credentials"
        ? "Nieprawidłowy adres e-mail lub hasło."
        : error.message;
  } finally {
    button.disabled = false;
    button.textContent = "Zaloguj się";
  }
});

el("logoutBtn").addEventListener("click", async () => {
  await supabaseClient.auth.signOut();

  records = [];

  el("appView").classList.add("hidden");
  el("loginView").classList.remove("hidden");
});

document.querySelectorAll(".nav-btn[data-view]").forEach(btn =>
  btn.addEventListener("click", () => switchView(btn.dataset.view))
);

document.querySelectorAll(".stat-card").forEach(card =>
  card.addEventListener("click", () => switchView("records", card.dataset.status))
);

el("showAllBtn").addEventListener("click", () => switchView("records", "do_weryfikacji"));
el("addRecordBtn").addEventListener("click", openAddForm);
el("topAddBtn").addEventListener("click", openAddForm);
el("closeEditor").addEventListener("click", closeEditor);
el("cancelEdit").addEventListener("click", closeEditor);
el("saveRecord").addEventListener("click", requestSave);
el("deleteRecord").addEventListener("click", deleteCurrentRecord);

["statusFilter", "categoryFilter"].forEach(id =>
  el(id).addEventListener("change", renderTable)
);
el("searchInput").addEventListener("input", renderTable);

el("resetFilters").addEventListener("click", () => {
  el("statusFilter").value = "all";
  el("categoryFilter").value = "all";
  el("searchInput").value = "";
  renderTable();
});

["editName", "editLat", "editLng"].forEach(id =>
  el(id).addEventListener("input", () => {
    if (id === "editLat" || id === "editLng") {
      const lat = Number(el("editLat").value);
      const lng = Number(el("editLng").value);
      if (Number.isFinite(lat) && Number.isFinite(lng)) marker.setLatLng([lat, lng]);
    }
    refreshDuplicateAlertFromForm();
  })
);


el("editSourceType").addEventListener("change", updateEditConditionalFields);
el("editPeriodType").addEventListener("change", updateEditConditionalFields);

el("editPhotos").addEventListener("change", () => {
  const input = el("editPhotos");

  const record = records.find(
    item => item.id === currentRecordId
  );

  if (!record) {
    return;
  }

  const existingCount = (record.photos || [])
    .filter(
      photo => !pendingPhotoDeletes.has(photo.id)
    )
    .length;

  const availableSlots =
    Math.max(0, 3 - existingCount);

  const selectedFiles =
    [...input.files].slice(0, availableSlots);

  pendingNewPhotoFiles.forEach(photo => {
    if (photo.previewUrl) {
      URL.revokeObjectURL(photo.previewUrl);
    }
  });

  pendingNewPhotoFiles = selectedFiles.map(file => ({
    file,
    previewUrl: URL.createObjectURL(file)
  }));

  if (availableSlots === 0) {
    el("editFormMessage").textContent =
      "Najpierw usuń jedno ze zdjęć, aby dodać nowe.";
  } else if (input.files.length > availableSlots) {
    el("editFormMessage").textContent =
      `Możesz dodać jeszcze tylko ${availableSlots} ${availableSlots === 1 ? "zdjęcie" : "zdjęcia"
      }.`;
  } else {
    el("editFormMessage").textContent = "";
  }

  input.value = "";

  renderEditPhotos(record);
});
el("cancelConfirm").addEventListener("click", () => {
  pendingSave = null;
  el("confirmOverlay").classList.add("hidden");
});

el("acceptConfirm").addEventListener("click", async () => {
  if (pendingSave?.adminAdd) {
    const finish = pendingSave.finish;

    pendingSave = null;
    el("confirmOverlay").classList.add("hidden");

    await finish();
    return;
  }

  if (pendingSave?.deleteId) {
    const deleteId = pendingSave.deleteId;

    try {
      await deletePhotosForSubmission(deleteId);

      const { error } = await supabaseClient
        .from("zgloszenia")
        .delete()
        .eq("id", deleteId);

      if (error) {
        throw error;
      }

      pendingSave = null;
      el("confirmOverlay").classList.add("hidden");

      closeEditor();

      await loadRecordsFromSupabase();

      updateStats();
      renderTable();

      if (addMap) {
        addObjectsLayer = renderOtherObjects(
          addMap,
          addObjectsLayer
        );
      }

      showToast("Rekord został usunięty z bazy.");
    } catch (error) {
      console.error(error);

      showToast(
        "Nie udało się usunąć rekordu: " +
        (error.message || "nieznany błąd")
      );
    }

    return;
  }

  if (pendingSave) {
    await commitSave(pendingSave);
  }
});

initSelects();
initMap();

el("closePhotoLightbox")
  ?.addEventListener("click", closePhotoLightbox);

el("photoLightbox")
  ?.addEventListener("click", event => {
    if (event.target === el("photoLightbox")) {
      closePhotoLightbox();
    }
  });

document.addEventListener("keydown", event => {
  if (
    event.key === "Escape" &&
    !el("photoLightbox")?.classList.contains("hidden")
  ) {
    closePhotoLightbox();
  }
});


function cleanAdminName(value) {
  if (!value) return "";
  return value.replace(/^gmina\s+/i, "").replace(/^powiat\s+/i, "").replace(/^województwo\s+/i, "").trim();
}

async function adminReverseGeocode(lat, lng) {
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=pl`);
    const json = await response.json();
    const a = json.address || {};
    el("addMiejscowosc").value = a.city || a.town || a.village || a.hamlet || "";
    el("addGmina").value = cleanAdminName(a.municipality || a.county || "");
    el("addPowiat").value = cleanAdminName(a.county || "");
    el("addWojewodztwo").value = cleanAdminName(a.state || "");
  } catch (error) {
    el("addFormMessage").textContent = "Nie udało się automatycznie pobrać danych administracyjnych.";
  }
}

function initAddMap() {
  if (addMap) return;
  addMap = L.map("addMap").setView([52, 19], 6);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" }).addTo(addMap);
  addMap.on("click", async event => {
    const { lat, lng } = event.latlng;
    el("addLat").value = lat; el("addLng").value = lng;
    if (addMarker) addMarker.setLatLng(event.latlng);
    else {
      addMarker = L.marker(event.latlng, {
        draggable: true,
        zIndexOffset: 1000
      }).addTo(addMap);
    }
    addMarker.off("dragend").on("dragend", async () => {
      const p = addMarker.getLatLng(); el("addLat").value = p.lat; el("addLng").value = p.lng; await adminReverseGeocode(p.lat, p.lng);
    });
    await adminReverseGeocode(lat, lng);
  });
}

function openAddForm() {
  el("addOverlay").classList.remove("hidden");

  setTimeout(() => {
    initAddMap();
    addMap.invalidateSize();

    addObjectsLayer = renderOtherObjects(
      addMap,
      addObjectsLayer
    );

    if (addMarker) {
      addMarker.setZIndexOffset(1000);
    }
  }, 50);
}

function closeAddForm() {
  clearAddPhotoPreviewUrls();

  el("addZdjecia").value = "";
  el("addFormMessage").textContent = "";

  el("addOverlay").classList.add("hidden");
}

async function loadRecordsFromSupabase() {
  console.log("Rozpoczynam pobieranie rekordów z Supabase...");

  const { data, error } = await supabaseClient
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
    lat,
    lng,
    status,
    duplikat_sprawdzony_dla,
    zdjecia (
      id,
      sciezka,
      url,
      podpis,
      data_dodania
    )
  `)
    .order("id", {
      ascending: false
    });

  console.log("Odpowiedź Supabase:", {
    data,
    error
  });

  if (error) {
    console.error(
      "Błąd pobierania zgłoszeń:",
      error
    );

    throw new Error(
      "Nie udało się pobrać obiektów z bazy: " +
      error.message
    );
  }

  records = (data || []).map(databaseRowToRecord);

  console.log(
    "Rekordy po konwersji:",
    records
  );
}
el("closeAddForm").addEventListener("click", closeAddForm);

el("addTypZrodla").addEventListener("change", () => {
  const show = el("addTypZrodla").value === "przekaz ustny";
  el("addOsobaWrapper").classList.toggle("hidden", !show);
  if (!show) el("addOsoba").value = "";
});

el("addTypOkresu").addEventListener("change", () => {
  const v = el("addTypOkresu").value;
  el("addDokladnaWrapper").classList.toggle("hidden", v !== "dokładna data");
  el("addOgolnyWrapper").classList.toggle("hidden", v !== "ogólny okres");
  if (v !== "dokładna data") el("addDokladnaData").value = "";
  if (v !== "ogólny okres") el("addOgolnyOkres").value = "";
});

function clearAddPhotoPreviewUrls() {
  addPhotoPreviewUrls.forEach(url => {
    URL.revokeObjectURL(url);
  });

  addPhotoPreviewUrls = [];

  const preview = el("addPhotoPreview");

  if (preview) {
    preview.innerHTML = "";
  }
}

el("addZdjecia").addEventListener("change", () => {
  clearAddPhotoPreviewUrls();

  const input = el("addZdjecia");
  const files = [...input.files].slice(0, 3);
  const preview = el("addPhotoPreview");

  files.forEach(file => {
    const previewUrl = URL.createObjectURL(file);

    addPhotoPreviewUrls.push(previewUrl);

    const img = document.createElement("img");
    img.src = previewUrl;
    img.alt = file.name;

    preview.appendChild(img);
  });

  if (input.files.length > 3) {
    el("addFormMessage").textContent =
      "Zostaną użyte tylko pierwsze 3 zdjęcia.";
  } else {
    el("addFormMessage").textContent = "";
  }
});

el("admin-place-form").addEventListener(
  "submit",
  async event => {
    event.preventDefault();

    const typOkresu =
      el("addTypOkresu").value;

    el("addFormMessage").textContent = "";

    if (!el("addLat").value || !el("addLng").value) {
      el("addFormMessage").textContent =
        "Najpierw kliknij miejsce na mapie.";
      return;
    }

    if (
      el("addTypZrodla").value === "przekaz ustny" &&
      !el("addOsoba").value
    ) {
      el("addFormMessage").textContent =
        "Wybierz osobę przekazującą.";
      return;
    }

    if (
      typOkresu === "dokładna data" &&
      !el("addDokladnaData").value
    ) {
      el("addFormMessage").textContent =
        "Wybierz dokładną datę.";
      return;
    }

    if (
      typOkresu === "ogólny okres" &&
      !el("addOgolnyOkres").value
    ) {
      el("addFormMessage").textContent =
        "Wybierz ogólny okres.";
      return;
    }

    const period =
      typOkresu === "dokładna data"
        ? el("addDokladnaData").value
        : typOkresu === "ogólny okres"
          ? el("addOgolnyOkres").value
          : "Nieznany";

    const record = {
      status: el("addStatus").value,

      name: el("addNazwa").value.trim(),
      category: el("addKategoria").value,
      description: el("addOpis").value.trim(),

      typePlace: el("addTypMiejsca").value,
      accuracy: el("addDokladnosc").value,

      place: el("addMiejscowosc").value.trim(),
      commune: el("addGmina").value.trim(),
      county: el("addPowiat").value.trim(),
      voivodeship: el("addWojewodztwo").value.trim(),

      sourceType: el("addTypZrodla").value,
      sourcePerson: el("addOsoba").value,

      periodType: typOkresu,

      exactDate:
        typOkresu === "dokładna data"
          ? el("addDokladnaData").value
          : "",

      generalPeriod:
        typOkresu === "ogólny okres"
          ? el("addOgolnyOkres").value
          : "",

      period,

      duplicateWarningDismissedKey: null,

      lat: Number(el("addLat").value),
      lng: Number(el("addLng").value)
    };

    const finish = async () => {
      const submitButton =
        event.submitter;

      submitButton.disabled = true;
      submitButton.textContent = "Zapisywanie...";

      try {
        const databaseRow =
          recordToDatabaseRow(record);

        const { data: insertedRecord, error } =
          await supabaseClient
            .from("zgloszenia")
            .insert(databaseRow)
            .select("id")
            .single();

        if (error) {
          throw error;
        }

        const newPhotoFiles = [
          ...el("addZdjecia").files
        ].slice(0, 3);

        if (newPhotoFiles.length) {
          await uploadAdminPhotos(
            insertedRecord.id,
            newPhotoFiles
          );
        }

        el("admin-place-form").reset();
        clearAddPhotoPreviewUrls();
        el("addFormMessage").textContent = "";

        el("addOsobaWrapper")
          .classList.add("hidden");

        el("addDokladnaWrapper")
          .classList.add("hidden");

        el("addOgolnyWrapper")
          .classList.add("hidden");

        if (addMarker) {
          addMap.removeLayer(addMarker);
          addMarker = null;
        }

        await loadRecordsFromSupabase();

        updateStats();
        renderTable();

        if (addMap) {
          addObjectsLayer = renderOtherObjects(
            addMap,
            addObjectsLayer
          );
        }

        closeAddForm();

        switchView(
          "records",
          record.status
        );

        showToast(
          "Obiekt został dodany do bazy."
        );
      } catch (error) {
        console.error(error);

        el("addFormMessage").textContent =
          "Nie udało się dodać obiektu: " +
          (error.message || "nieznany błąd");
      } finally {
        submitButton.disabled = false;
        submitButton.textContent = "Dodaj obiekt";
      }
    };

    if (record.status === "opublikowany") {
      pendingSave = {
        adminAdd: true,
        finish
      };

      el("confirmTitle").textContent =
        "Czy na pewno opublikować obiekt?";

      el("confirmText").textContent =
        "Po zapisaniu obiekt będzie widoczny na publicznej mapie.";

      el("acceptConfirm").textContent =
        "Opublikuj";

      el("confirmOverlay")
        .classList.remove("hidden");
    } else {
      await finish();
    }
  }
);

async function restoreAdminSession() {
  console.log("Sprawdzam istniejącą sesję...");

  const {
    data: { session },
    error: sessionError
  } = await supabaseClient.auth.getSession();

  if (sessionError) {
    console.error(
      "Błąd odczytu sesji:",
      sessionError
    );
    return;
  }

  if (!session) {
    console.log("Brak zapisanej sesji.");
    return;
  }

  console.log(
    "Znaleziono sesję użytkownika:",
    session.user.email
  );

  try {
    const { data: adminRecord, error } =
      await supabaseClient
        .from("administratorzy")
        .select("user_id")
        .eq("user_id", session.user.id)
        .maybeSingle();

    if (error) {
      throw error;
    }

    if (!adminRecord) {
      await supabaseClient.auth.signOut();
      return;
    }

    await openAdminPanel();
  } catch (error) {
    console.error(
      "Nie udało się przywrócić panelu:",
      error
    );
  }
}

restoreAdminSession();

window.addEventListener("pagehide", () => {
  clearAddPhotoPreviewUrls();
  clearPendingPhotoChanges();
});