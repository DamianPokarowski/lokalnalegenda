const MAX_LENGTHS = {
    nazwa: 150,
    kategoria: 100,
    opis: 5000,
    typ_miejsca: 100,
    dokladnosc_miejsca: 100,
    miejscowosc: 150,
    gmina: 150,
    powiat: 150,
    wojewodztwo: 150,
    typ_zrodla: 100,
    osoba_przekazujaca: 100,
    typ_okresu: 100,
    dokladna_data: 20,
    ogolny_okres: 100
};

const REQUIRED_FIELDS = [
    "nazwa",
    "kategoria",
    "opis",
    "typ_miejsca",
    "dokladnosc_miejsca",
    "typ_zrodla",
    "typ_okresu"
];

function normalizeText(value) {
    if (typeof value !== "string") {
        return "";
    }

    return value.trim();
}

function normalizeOptionalText(value) {
    const normalized = normalizeText(value);

    return normalized || null;
}

function validateTextLength(field, value) {
    const maxLength = MAX_LENGTHS[field];

    if (
        maxLength &&
        typeof value === "string" &&
        value.length > maxLength
    ) {
        throw new Error(
            `Pole „${field}” może mieć maksymalnie ${maxLength} znaków.`
        );
    }
}

function parseCoordinate(value, field, min, max) {
    const number = Number(value);

    if (
        !Number.isFinite(number) ||
        number < min ||
        number > max
    ) {
        throw new Error(
            `Pole „${field}” zawiera nieprawidłową współrzędną.`
        );
    }

    return number;
}

export function validateReportPayload(input) {
    if (
        !input ||
        typeof input !== "object" ||
        Array.isArray(input)
    ) {
        throw new Error(
            "Dane zgłoszenia mają nieprawidłowy format."
        );
    }

    const payload = {
        nazwa: normalizeText(input.nazwa),
        kategoria: normalizeText(input.kategoria),
        opis: normalizeText(input.opis),
        typ_miejsca: normalizeText(input.typ_miejsca),
        dokladnosc_miejsca:
            normalizeText(input.dokladnosc_miejsca),

        miejscowosc:
            normalizeOptionalText(input.miejscowosc),

        gmina:
            normalizeOptionalText(input.gmina),

        powiat:
            normalizeOptionalText(input.powiat),

        wojewodztwo:
            normalizeOptionalText(input.wojewodztwo),

        typ_zrodla:
            normalizeText(input.typ_zrodla),

        osoba_przekazujaca:
            normalizeOptionalText(input.osoba_przekazujaca),

        typ_okresu:
            normalizeText(input.typ_okresu),

        dokladna_data:
            normalizeOptionalText(input.dokladna_data),

        ogolny_okres:
            normalizeOptionalText(input.ogolny_okres),

        lat: parseCoordinate(
            input.lat,
            "lat",
            -90,
            90
        ),

        lng: parseCoordinate(
            input.lng,
            "lng",
            -180,
            180
        )
    };

    for (const field of REQUIRED_FIELDS) {
        if (!payload[field]) {
            throw new Error(
                `Pole „${field}” jest wymagane.`
            );
        }
    }

    for (const [field, value] of Object.entries(payload)) {
        validateTextLength(field, value);
    }

    if (
        payload.typ_zrodla === "przekaz ustny" &&
        !payload.osoba_przekazujaca
    ) {
        throw new Error(
            "Wybierz osobę przekazującą informację."
        );
    }

    if (payload.typ_zrodla !== "przekaz ustny") {
        payload.osoba_przekazujaca = null;
    }

    if (
        payload.typ_okresu === "dokładna data" &&
        !payload.dokladna_data
    ) {
        throw new Error(
            "Wybierz dokładną datę wystąpienia zjawiska."
        );
    }

    if (
        payload.typ_okresu === "ogólny okres" &&
        !payload.ogolny_okres
    ) {
        throw new Error(
            "Wybierz ogólny okres wystąpienia zjawiska."
        );
    }

    if (payload.typ_okresu !== "dokładna data") {
        payload.dokladna_data = null;
    }

    if (payload.typ_okresu !== "ogólny okres") {
        payload.ogolny_okres = null;
    }

    return payload;
}