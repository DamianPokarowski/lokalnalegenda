const SUPABASE_URL = "https://aywbgpsgihbginuyuxpn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_gKk-hEOT-RC7M1xkJQU7uA_0VJz8-pF";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function ensureSubmissionSession() {
    const {
        data: { session },
        error: sessionError
    } = await supabaseClient.auth.getSession();

    if (sessionError) {
        throw sessionError;
    }

    if (session) {
        return session;
    }

    const {
        data,
        error
    } = await supabaseClient.auth.signInAnonymously();

    if (error) {
        throw error;
    }

    if (!data.session?.user?.id) {
        throw new Error(
            "Nie udało się utworzyć bezpiecznej sesji zgłoszenia."
        );
    }

    return data.session;
}

const defaultCenter = [52.0, 19.0];
const defaultZoom = 6;

const map = L.map("map").setView(defaultCenter, defaultZoom);

const darkOsmLayer = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap"
    }
);

const osmLayer = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap"
    }
);

const topoLayer = L.tileLayer(
    "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    {
        maxZoom: 17,
        attribution: "&copy; OpenTopoMap"
    }
);

const satelliteLayer = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
        attribution: "Tiles © Esri"
    }
);

osmLayer.addTo(map);

const baseLayers = {
    dark: darkOsmLayer,
    osm: osmLayer,
    topo: topoLayer,
    satellite: satelliteLayer
};

let selectedMarker = null;
let existingObjectsLayer = null;
let showExistingObjects = true;

const latInput = document.querySelector("#lat");
const lngInput = document.querySelector("#lng");

const typZrodlaInput = document.querySelector("#typ_zrodla");
const osobaWrapper = document.querySelector("#osoba-wrapper");
const osobaInput = document.querySelector("#osoba_przekazujaca");

const typOkresuInput = document.querySelector("#typ_okresu");
const dokladnaDataWrapper = document.querySelector("#dokladna-data-wrapper");
const ogolnyOkresWrapper = document.querySelector("#ogolny-okres-wrapper");

const dokladnaDataInput = document.querySelector("#dokladna_data");
const ogolnyOkresInput = document.querySelector("#ogolny_okres");

const zdjeciaInput = document.querySelector("#zdjecia");
const photoPreview = document.querySelector("#photo-preview");
let photoPreviewUrls = [];
let selectedPhotoFiles = [];
let photoSelectionError = null;

const form = document.querySelector("#place-form");
const submitBtn = document.querySelector("#submit-btn");
const formMessage = document.querySelector("#form-message");

const grayMarkerIcon = L.divIcon({
    className: "gray-object-marker",

    html: `
        <svg viewBox="0 0 32 45"
             xmlns="http://www.w3.org/2000/svg">
            <path
                d="M16 1C8.3 1 2 7.3 2 15c0 10.5 14 28 14 28s14-17.5 14-28C30 7.3 23.7 1 16 1z"
                fill="#777"
                stroke="#d0d0d0"
                stroke-width="2"
            />

            <circle
                cx="16"
                cy="15"
                r="5"
                fill="#303030"
            />
        </svg>
    `,

    iconSize: [32, 45],
    iconAnchor: [16, 43],
    popupAnchor: [0, -42]
});

const DOZWOLONE_TYPY_ZDJEC = new Set([
    "image/jpeg",
    "image/png",
    "image/webp"
]);

const MAKSYMALNY_ROZMIAR_ZDJECIA = 20 * 1024 * 1024; // 20 MB

function walidujZdjecie(file) {
    if (!file) {
        return "Nie wybrano pliku.";
    }

    if (!DOZWOLONE_TYPY_ZDJEC.has(file.type)) {
        return `Plik „${file.name}” nie jest obsługiwanym zdjęciem. Dozwolone są JPG, PNG i WebP.`;
    }

    if (file.size <= 0) {
        return `Plik „${file.name}” jest pusty.`;
    }

    if (file.size > MAKSYMALNY_ROZMIAR_ZDJECIA) {
        return `Plik „${file.name}” jest za duży. Maksymalny rozmiar to 20 MB.`;
    }

    return null;
}

function clearPhotoPreviewUrls() {
    photoPreviewUrls.forEach(url => {
        URL.revokeObjectURL(url);
    });

    photoPreviewUrls = [];
    photoPreview.innerHTML = "";
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

async function loadExistingObjects() {
    const { data, error } = await supabaseClient
        .from("zgloszenia")
        .select(`
            id,
            nazwa,
            kategoria,
            miejscowosc,
            lat,
            lng,
            status
        `)
        .eq("status", "opublikowany");

    if (error) {
        console.error(
            "Nie udało się pobrać istniejących obiektów:",
            error
        );

        return;
    }

    renderExistingObjects(data || []);
}

function renderExistingObjects(objects) {
    if (existingObjectsLayer) {
        existingObjectsLayer.clearLayers();
    } else {
        if (L.markerClusterGroup) {
            existingObjectsLayer = L.markerClusterGroup({
                showCoverageOnHover: false,
                maxClusterRadius: 45,
                spiderfyOnMaxZoom: true,
                disableClusteringAtZoom: 15,
                removeOutsideVisibleBounds: true
            });
        } else {
            console.warn(
                "MarkerCluster nie został załadowany. Używam zwykłej warstwy."
            );

            existingObjectsLayer = L.layerGroup();
        }
    }

    if (
        showExistingObjects &&
        !map.hasLayer(existingObjectsLayer)
    ) {
        existingObjectsLayer.addTo(map);
    }

    objects.forEach(object => {
        if (
            object.lat === null ||
            object.lng === null ||
            object.lat === "" ||
            object.lng === ""
        ) {
            return;
        }

        const lat = Number(object.lat);
        const lng = Number(object.lng);

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

        const objectMarker = L.marker(
            [lat, lng],
            {
                icon: grayMarkerIcon,
                interactive: true,
                keyboard: false,
                zIndexOffset: 0
            }
        );

        objectMarker.bindPopup(`
            <div class="existing-object-popup">
                <strong>
                    ${escapeHtml(object.nazwa || "Istniejące miejsce")}
                </strong>

                <span>
                    ${escapeHtml(object.kategoria || "")}
                </span>

                ${object.miejscowosc
                ? `
                            <span>
                                ${escapeHtml(object.miejscowosc)}
                            </span>
                        `
                : ""
            }

                <small>
                    To miejsce znajduje się już w bazie.
                </small>
            </div>
        `);

        objectMarker.addTo(existingObjectsLayer);
    });
}

map.on("click", async event => {
    const { lat, lng } = event.latlng;

    latInput.value = lat;
    lngInput.value = lng;

    if (selectedMarker) {
        selectedMarker.setLatLng(event.latlng);
    } else {
        selectedMarker = L.marker(
            event.latlng,
            {
                draggable: true,
                zIndexOffset: 1000
            }
        ).addTo(map);

        selectedMarker.on("dragend", async () => {
            const position = selectedMarker.getLatLng();

            latInput.value = position.lat;
            lngInput.value = position.lng;

            await reverseGeocode(
                position.lat,
                position.lng
            );
        });
    }

    selectedMarker.bindTooltip("Wybrana lokalizacja", {
        permanent: true,
        direction: "top",
        offset: [-16, -12],
        className: "selected-location-tooltip"
    }).openTooltip();

    await reverseGeocode(lat, lng);
});

typZrodlaInput.addEventListener("change", () => {
    if (typZrodlaInput.value === "przekaz ustny") {
        osobaWrapper.classList.remove("hidden");
    } else {
        osobaWrapper.classList.add("hidden");
        osobaInput.value = "";
    }
});

typOkresuInput.addEventListener("change", () => {
    const value = typOkresuInput.value;

    dokladnaDataWrapper.classList.add("hidden");
    ogolnyOkresWrapper.classList.add("hidden");

    dokladnaDataInput.value = "";
    ogolnyOkresInput.value = "";

    if (value === "dokładna data") {
        dokladnaDataWrapper.classList.remove("hidden");
    }

    if (value === "ogólny okres") {
        ogolnyOkresWrapper.classList.remove("hidden");
    }
});

function ustawWybraneZdjecia(files) {
    selectedPhotoFiles = [...files];
}

function czyTenSamPlik(fileA, fileB) {
    return (
        fileA.name === fileB.name &&
        fileA.size === fileB.size &&
        fileA.lastModified === fileB.lastModified
    );
}

function renderPhotoPreviews() {
    clearPhotoPreviewUrls();

    selectedPhotoFiles.forEach((file, index) => {
        const previewUrl = URL.createObjectURL(file);

        photoPreviewUrls.push(previewUrl);

        const previewItem = document.createElement("div");
        previewItem.className = "photo-preview-item";

        const img = document.createElement("img");
        img.src = previewUrl;
        img.alt = file.name;

        img.addEventListener("error", () => {
            previewItem.remove();
        });

        const removeButton = document.createElement("button");

        removeButton.type = "button";
        removeButton.className = "photo-remove-btn";
        removeButton.setAttribute(
            "aria-label",
            `Usuń zdjęcie ${file.name}`
        );

        removeButton.title = "Usuń zdjęcie";
        removeButton.textContent = "×";

        removeButton.addEventListener("click", () => {
            const pozostalePliki = selectedPhotoFiles.filter(
                (_, fileIndex) => fileIndex !== index
            );

            ustawWybraneZdjecia(pozostalePliki);
            renderPhotoPreviews();

            if (pozostalePliki.length === 0) {
                showMessage(
                    "Usunięto wszystkie zdjęcia.",
                    false
                );

                return;
            }

            const odmiana =
                pozostalePliki.length === 1
                    ? "zdjęcie"
                    : "zdjęcia";

            showMessage(
                `Pozostało ${pozostalePliki.length} ${odmiana}.`,
                false
            );
        });

        previewItem.appendChild(img);
        previewItem.appendChild(removeButton);

        photoPreview.appendChild(previewItem);
    });
}

zdjeciaInput.addEventListener("change", () => {
    const nowePliki = [...zdjeciaInput.files];
    photoSelectionError = null;

    let pierwszyBlad = null;
    let przekroczonoLimit = false;
    let znalezionoDuplikat = false;

    const polaczonePliki = [...selectedPhotoFiles];

    for (const file of nowePliki) {
        const blad = walidujZdjecie(file);

        if (blad) {
            if (!pierwszyBlad) {
                pierwszyBlad = blad;
            }

            continue;
        }

        const plikJuzIstnieje = polaczonePliki.some(
            existingFile => czyTenSamPlik(existingFile, file)
        );

        if (plikJuzIstnieje) {
            znalezionoDuplikat = true;
            continue;
        }

        if (polaczonePliki.length >= 3) {
            przekroczonoLimit = true;
            continue;
        }

        polaczonePliki.push(file);
    }

    ustawWybraneZdjecia(polaczonePliki);
    renderPhotoPreviews();
    zdjeciaInput.value = "";

    if (pierwszyBlad) {
        photoSelectionError = pierwszyBlad;
        showMessage(pierwszyBlad, true);
        return;
    }

    if (przekroczonoLimit) {
        showMessage(
            "Możesz dodać maksymalnie 3 zdjęcia.",
            true
        );

        return;
    }

    if (znalezionoDuplikat) {
        showMessage(
            "To zdjęcie zostało już wcześniej wybrane.",
            false
        );

        return;
    }

    if (selectedPhotoFiles.length > 0) {
        const odmiana =
            selectedPhotoFiles.length === 1
                ? "zdjęcie"
                : "zdjęcia";

        showMessage(
            `Wybrano ${selectedPhotoFiles.length} ${odmiana}.`,
            false
        );
    }
});

form.addEventListener("submit", async event => {
    event.preventDefault();

    if (photoSelectionError) {
        showMessage(
            `${photoSelectionError} Usuń problem lub wybierz poprawne zdjęcie przed wysłaniem zgłoszenia.`,
            true
        );

        return;
    }

    if (!latInput.value || !lngInput.value) {
        showMessage("Najpierw kliknij miejsce na mapie.", true);
        return;
    }

    if (typZrodlaInput.value === "przekaz ustny" && !osobaInput.value) {
        showMessage("Wybierz osobę przekazującą.", true);
        return;
    }

    if (typOkresuInput.value === "dokładna data" && !dokladnaDataInput.value) {
        showMessage("Wybierz dokładną datę.", true);
        return;
    }

    if (typOkresuInput.value === "ogólny okres" && !ogolnyOkresInput.value) {
        showMessage("Wybierz ogólny okres.", true);
        return;
    }

    const filesToUpload = [...selectedPhotoFiles];

    if (filesToUpload.length > 3) {
        showMessage("Możesz przesłać maksymalnie 3 zdjęcia.", true);
        return;
    }

    for (const file of filesToUpload) {
        const blad = walidujZdjecie(file);

        if (blad) {
            showMessage(blad, true);
            return;
        }
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Wysyłanie...";
    showMessage("Trwa wysyłanie zgłoszenia...", false);

    try {
        const session = await ensureSubmissionSession();
        const payload = {
            nazwa: value("#nazwa"),
            kategoria: value("#kategoria"),
            opis: value("#opis"),
            typ_miejsca: value("#typ_miejsca"),
            dokladnosc_miejsca: value("#dokladnosc_miejsca"),
            miejscowosc: value("#miejscowosc"),
            gmina: value("#gmina"),
            powiat: value("#powiat"),
            wojewodztwo: value("#wojewodztwo"),
            typ_zrodla: value("#typ_zrodla"),
            osoba_przekazujaca: value("#osoba_przekazujaca") || null,
            typ_okresu: value("#typ_okresu"),
            dokladna_data: value("#dokladna_data") || null,
            ogolny_okres: value("#ogolny_okres") || null,
            lat: Number(latInput.value),
            lng: Number(lngInput.value),
            status: "oczekuje",
            submitted_by: session.user.id
        };

        const { data, error } = await supabaseClient
            .from("zgloszenia")
            .insert(payload)
            .select("id")
            .single();

        if (error) throw error;

        const zgloszenieId = data.id;

        for (const file of filesToUpload) {
            const compressed = await compressImage(file);

            const safeName = file.name
                .toLowerCase()
                .replaceAll(" ", "_")
                .replace(/[^a-z0-9._-]/g, "");

            const filePath = `${session.user.id}/zgloszenie_${zgloszenieId}/${Date.now()}_${safeName}`;

            const { error: uploadError } = await supabaseClient
                .storage
                .from("zdjecia")
                .upload(filePath, compressed, {
                    contentType: compressed.type,
                    upsert: false
                });

            if (uploadError) throw uploadError;

            const { data: publicData } = supabaseClient
                .storage
                .from("zdjecia")
                .getPublicUrl(filePath);

            const { error: photoError } = await supabaseClient
                .from("zdjecia")
                .insert({
                    zgloszenie_id: zgloszenieId,
                    sciezka: filePath,
                    url: publicData.publicUrl,
                    submitted_by: session.user.id
                });

            if (photoError) throw photoError;
        }

        form.reset();
        selectedPhotoFiles = [];
        photoSelectionError = null;
        zdjeciaInput.value = "";
        clearPhotoPreviewUrls();

        if (selectedMarker) {
            map.removeLayer(selectedMarker);
            selectedMarker = null;
        }

        showMessage("Zgłoszenie zostało wysłane. Dziękujemy!", false);
    } catch (error) {
        console.error(
            "Błąd wysyłania zgłoszenia:",
            error
        );

        const komunikat =
            error instanceof Error && error.message
                ? error.message
                : "Wystąpił błąd podczas wysyłania zgłoszenia.";

        showMessage(komunikat, true);
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Wyślij zgłoszenie";
    }
});

function value(selector) {
    return document.querySelector(selector)?.value.trim() || "";
}

function showMessage(text, isError) {
    formMessage.textContent = text;
    formMessage.style.color = isError ? "#ff8c8c" : "#ffe8a6";
}

function cleanAdminName(value) {
    if (!value) return "";

    return value
        .replace(/^gmina\s+/i, "")
        .replace(/^powiat\s+/i, "")
        .replace(/^województwo\s+/i, "")
        .trim();
}

async function reverseGeocode(lat, lng) {
    try {
        const url =
            `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=pl`;

        const response = await fetch(url);
        const json = await response.json();

        const address = json.address || {};

        document.querySelector("#miejscowosc").value =
            address.city ||
            address.town ||
            address.village ||
            address.hamlet ||
            "";

        document.querySelector("#gmina").value =
            cleanAdminName(
                address.municipality ||
                address.county ||
                ""
            );

        document.querySelector("#powiat").value =
            cleanAdminName(address.county || "");

        document.querySelector("#wojewodztwo").value =
            cleanAdminName(address.state || "");

    } catch (error) {
        console.warn("Nie udało się automatycznie pobrać danych administracyjnych.", error);
    }
}

async function compressImage(file) {
    const bladWalidacji = walidujZdjecie(file);

    if (bladWalidacji) {
        throw new Error(bladWalidacji);
    }

    return new Promise((resolve, reject) => {
        const img = new Image();
        const reader = new FileReader();

        const cleanup = () => {
            img.onload = null;
            img.onerror = null;
            reader.onload = null;
            reader.onerror = null;
            reader.onabort = null;
        };

        reader.onerror = () => {
            cleanup();

            reject(
                new Error(
                    `Nie udało się odczytać pliku „${file.name}”.`
                )
            );
        };

        reader.onabort = () => {
            cleanup();

            reject(
                new Error(
                    `Odczyt pliku „${file.name}” został przerwany.`
                )
            );
        };

        reader.onload = event => {
            if (
                !event.target ||
                typeof event.target.result !== "string"
            ) {
                cleanup();

                reject(
                    new Error(
                        `Plik „${file.name}” ma nieprawidłową zawartość.`
                    )
                );

                return;
            }

            img.src = event.target.result;
        };

        img.onerror = () => {
            cleanup();

            reject(
                new Error(
                    `Plik „${file.name}” nie jest prawidłowym obrazem.`
                )
            );
        };

        img.onload = () => {
            try {
                const maxWidth = 1600;
                const maxHeight = 1600;

                let width = img.naturalWidth;
                let height = img.naturalHeight;

                if (
                    !Number.isFinite(width) ||
                    !Number.isFinite(height) ||
                    width <= 0 ||
                    height <= 0
                ) {
                    throw new Error(
                        `Nie udało się odczytać wymiarów zdjęcia „${file.name}”.`
                    );
                }

                if (width > height && width > maxWidth) {
                    height = Math.round(
                        height * maxWidth / width
                    );

                    width = maxWidth;
                } else if (height > maxHeight) {
                    width = Math.round(
                        width * maxHeight / height
                    );

                    height = maxHeight;
                }

                const canvas = document.createElement("canvas");

                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext("2d");

                if (!ctx) {
                    throw new Error(
                        "Przeglądarka nie obsługuje przetwarzania zdjęć."
                    );
                }

                ctx.drawImage(img, 0, 0, width, height);

                canvas.toBlob(
                    blob => {
                        cleanup();

                        if (!blob || blob.size <= 0) {
                            reject(
                                new Error(
                                    `Nie udało się skompresować zdjęcia „${file.name}”.`
                                )
                            );

                            return;
                        }

                        const baseName =
                            file.name
                                .replace(/\.[^/.]+$/, "")
                                .trim() || "zdjecie";

                        const compressedFile = new File(
                            [blob],
                            `${baseName}.jpg`,
                            {
                                type: "image/jpeg",
                                lastModified: Date.now()
                            }
                        );

                        resolve(compressedFile);
                    },
                    "image/jpeg",
                    0.78
                );
            } catch (error) {
                cleanup();

                reject(
                    error instanceof Error
                        ? error
                        : new Error(
                            "Nie udało się przetworzyć zdjęcia."
                        )
                );
            }
        };

        try {
            reader.readAsDataURL(file);
        } catch (error) {
            cleanup();

            reject(
                error instanceof Error
                    ? error
                    : new Error(
                        `Nie udało się otworzyć pliku „${file.name}”.`
                    )
            );
        }
    });
}

document.querySelectorAll(".basemap-btn").forEach(button => {
    button.addEventListener("click", () => {
        Object.values(baseLayers).forEach(layer => {
            if (map.hasLayer(layer)) {
                map.removeLayer(layer);
            }
        });

        const selected = button.dataset.layer;
        baseLayers[selected].addTo(map);

        document.body.classList.remove("dark-map");

        if (selected === "dark") {
            document.body.classList.add("dark-map");
        }

        document
            .querySelectorAll(".basemap-btn")
            .forEach(btn => btn.classList.remove("active"));

        button.classList.add("active");
    });
});

const basemapControl = document.querySelector("#basemap-control");
const basemapToggle = document.querySelector("#basemap-toggle");

if (basemapControl && basemapToggle) {
    basemapToggle.addEventListener("click", () => {
        basemapControl.classList.toggle("collapsed");

        basemapToggle.classList.toggle(
            "collapsed",
            basemapControl.classList.contains("collapsed")
        );
    });
}

const zoomControl = document.querySelector(".leaflet-control-zoom");

if (zoomControl) {
    const homeButton = document.createElement("a");

    homeButton.className = "leaflet-control-zoom-home";
    homeButton.href = "#";
    homeButton.title = "Pokaż całą mapę";

    homeButton.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none"
         stroke="currentColor"
         stroke-width="2.3"
         stroke-linecap="round"
         stroke-linejoin="round">
      <path d="M3 10.5L12 3l9 7.5"></path>
      <path d="M5 9.5V21h14V9.5"></path>
      <path d="M10 21v-6h4v6"></path>
    </svg>
  `;

    homeButton.addEventListener("click", event => {
        L.DomEvent.stop(event);

        map.flyTo(defaultCenter, defaultZoom, {
            duration: 0.3
        });
    });

    zoomControl.prepend(homeButton);
}

const existingButton = document.createElement("button");

existingButton.type = "button";
existingButton.id = "toggleExistingObjects";
existingButton.className = "leaflet-control-zoom-home existing-map-button active";
existingButton.title = "Ukryj istniejące miejsca";
existingButton.setAttribute(
    "aria-label",
    "Pokaż lub ukryj istniejące miejsca"
);

existingButton.innerHTML = `
    <svg viewBox="0 0 24 24"
         fill="none"
         stroke="currentColor"
         stroke-width="2.3"
         stroke-linecap="round"
         stroke-linejoin="round">
        <path d="M12 21s6-5.2 6-11a6 6 0 1 0-12 0c0 5.8 6 11 6 11z"></path>
        <circle cx="12" cy="10" r="2"></circle>
    </svg>
`;

document
    .querySelector(".map-panel")
    .appendChild(existingButton);

existingButton.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();

    showExistingObjects = !showExistingObjects;

    if (!existingObjectsLayer) {
        return;
    }

    if (showExistingObjects) {
        if (!map.hasLayer(existingObjectsLayer)) {
            map.addLayer(existingObjectsLayer);
        }

        existingButton.classList.add("active");
        existingButton.title = "Ukryj istniejące miejsca";
    } else {
        if (map.hasLayer(existingObjectsLayer)) {
            map.removeLayer(existingObjectsLayer);
        }

        existingButton.classList.remove("active");
        existingButton.title = "Pokaż istniejące miejsca";
    }
});

const locateControl = L.control({ position: "bottomleft" });

locateControl.onAdd = function () {
    const button = L.DomUtil.create("button", "locate-button");
    button.type = "button";
    button.title = "Pokaż moją lokalizację";

    button.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none"
         stroke="currentColor"
         stroke-width="2.3"
         stroke-linecap="round"
         stroke-linejoin="round">
      <circle cx="12" cy="12" r="7"></circle>
      <path d="M12 2v3"></path>
      <path d="M12 19v3"></path>
      <path d="M2 12h3"></path>
      <path d="M19 12h3"></path>
      <circle cx="12" cy="12" r="2"></circle>
    </svg>
  `;

    L.DomEvent.disableClickPropagation(button);

    button.addEventListener("click", () => {
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

map.on("locationfound", event => {
    if (userLocationMarker) {
        map.removeLayer(userLocationMarker);
    }

    if (userAccuracyCircle) {
        map.removeLayer(userAccuracyCircle);
    }

    userLocationMarker = L.circleMarker(event.latlng, {
        radius: 8,
        color: "#d4af37",
        weight: 2,
        fillColor: "#1e90ff",
        fillOpacity: 0.9
    }).addTo(map);

    userAccuracyCircle = L.circle(event.latlng, {
        radius: event.accuracy,
        color: "#d4af37",
        weight: 1,
        fillOpacity: 0.08
    }).addTo(map);

    userLocationMarker.bindPopup("Twoja lokalizacja").openPopup();
});

map.on("locationerror", () => {
    alert("Nie udało się pobrać lokalizacji. Sprawdź zgodę w przeglądarce.");
});

const coordsControl = L.control({ position: "bottomright" });

coordsControl.onAdd = function () {
    const div = L.DomUtil.create("div", "coords-box");

    div.innerHTML = "-- , --";

    map.on("mousemove", e => {
        div.innerHTML = `N ${e.latlng.lat.toFixed(5)} | E ${e.latlng.lng.toFixed(5)}`;
    });

    return div;
};

coordsControl.addTo(map);
loadExistingObjects();

window.addEventListener("pagehide", clearPhotoPreviewUrls);
