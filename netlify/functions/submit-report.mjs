import {
    verifyTurnstileToken
} from "./lib/turnstile.mjs";

import {
    validateReportPayload
} from "./lib/validation.mjs";

import {
    supabaseRequest
} from "./lib/supabase.mjs";

const MAX_PHOTOS = 3;
const MAX_SINGLE_PHOTO_SIZE = 4 * 1024 * 1024;
const MAX_TOTAL_PHOTO_SIZE = 6 * 1024 * 1024;

const ALLOWED_PHOTO_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp"
]);

function jsonResponse(body, status = 200) {
    return new Response(
        JSON.stringify(body),
        {
            status,
            headers: {
                "Content-Type":
                    "application/json; charset=utf-8",
                "Cache-Control": "no-store"
            }
        }
    );
}

function getSupabaseConfig() {
    const url = process.env.SUPABASE_URL;
    const secretKey =
        process.env.SUPABASE_SECRET_KEY;

    if (!url) {
        throw new Error(
            "Brak zmiennej SUPABASE_URL."
        );
    }

    if (!secretKey) {
        throw new Error(
            "Brak zmiennej SUPABASE_SECRET_KEY."
        );
    }

    return {
        url: url.replace(/\/$/, ""),
        secretKey
    };
}

function getRemoteIp(request) {
    const forwardedFor =
        request.headers.get("x-forwarded-for");

    if (forwardedFor) {
        return forwardedFor
            .split(",")[0]
            .trim() || null;
    }

    return (
        request.headers.get(
            "x-nf-client-connection-ip"
        ) || null
    );
}

function sanitizeFileName(fileName) {
    const cleaned = String(fileName || "zdjecie.jpg")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, "_")
        .replace(/[^a-z0-9._-]/g, "")
        .replace(/_+/g, "_")
        .slice(0, 100);

    return cleaned || "zdjecie.jpg";
}

function validatePhotos(files) {
    if (files.length > MAX_PHOTOS) {
        throw new Error(
            "Możesz przesłać maksymalnie 3 zdjęcia."
        );
    }

    let totalSize = 0;

    for (const file of files) {
        if (!(file instanceof File)) {
            throw new Error(
                "Przesłano nieprawidłowy plik."
            );
        }

        if (!ALLOWED_PHOTO_TYPES.has(file.type)) {
            throw new Error(
                `Plik „${file.name}” ma niedozwolony format.`
            );
        }

        if (file.size <= 0) {
            throw new Error(
                `Plik „${file.name}” jest pusty.`
            );
        }

        if (file.size > MAX_SINGLE_PHOTO_SIZE) {
            throw new Error(
                `Plik „${file.name}” jest zbyt duży po kompresji.`
            );
        }

        totalSize += file.size;
    }

    if (totalSize > MAX_TOTAL_PHOTO_SIZE) {
        throw new Error(
            "Łączny rozmiar zdjęć po kompresji jest zbyt duży."
        );
    }
}

async function getAuthenticatedUser(accessToken) {
    if (
        typeof accessToken !== "string" ||
        !accessToken.trim()
    ) {
        throw new Error(
            "Brak bezpiecznej sesji zgłoszenia."
        );
    }

    const { url, secretKey } =
        getSupabaseConfig();

    const response = await fetch(
        `${url}/auth/v1/user`,
        {
            method: "GET",
            headers: {
                apikey: secretKey,
                Authorization:
                    `Bearer ${accessToken.trim()}`,
                Accept: "application/json"
            }
        }
    );

    const text = await response.text();

    let data = null;

    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = null;
        }
    }

    if (
        !response.ok ||
        !data ||
        typeof data.id !== "string"
    ) {
        throw new Error(
            "Sesja zgłoszenia jest nieprawidłowa lub wygasła."
        );
    }

    return data;
}

async function uploadPhoto(
    file,
    userId,
    reportId,
    index
) {
    const { url, secretKey } =
        getSupabaseConfig();

    const safeFileName =
        sanitizeFileName(file.name);

    const uniquePart =
        `${Date.now()}_${crypto.randomUUID()}`;

    const filePath =
        `${userId}/zgloszenie_${reportId}/` +
        `${index}_${uniquePart}_${safeFileName}`;

    const encodedPath = filePath
        .split("/")
        .map(part => encodeURIComponent(part))
        .join("/");

    const response = await fetch(
        `${url}/storage/v1/object/zdjecia/${encodedPath}`,
        {
            method: "POST",
            headers: {
                apikey: secretKey,
                "Content-Type":
                    file.type || "application/octet-stream",
                "x-upsert": "false"
            },
            body: file
        }
    );

    const responseText =
        await response.text();

    let responseData = null;

    if (responseText) {
        try {
            responseData =
                JSON.parse(responseText);
        } catch {
            responseData = responseText;
        }
    }

    if (!response.ok) {
        const error = new Error(
            `Nie udało się przesłać zdjęcia „${file.name}”.`
        );

        error.details = responseData;
        throw error;
    }

    const publicUrl =
        `${url}/storage/v1/object/public/zdjecia/${encodedPath}`;

    return {
        filePath,
        publicUrl
    };
}

export default async request => {
    if (request.method !== "POST") {
        return jsonResponse(
            {
                success: false,
                error:
                    "Dozwolona jest wyłącznie metoda POST."
            },
            405
        );
    }

    try {
        const contentType =
            request.headers.get("content-type") || "";

        if (
            !contentType
                .toLowerCase()
                .includes("multipart/form-data")
        ) {
            return jsonResponse(
                {
                    success: false,
                    error:
                        "Nieprawidłowy format zgłoszenia."
                },
                415
            );
        }

        const formData =
            await request.formData();

        const turnstileToken =
            String(
                formData.get("turnstileToken") || ""
            ).trim();

        const accessToken =
            String(
                formData.get("accessToken") || ""
            ).trim();

        const payloadText =
            String(
                formData.get("payload") || ""
            );

        let rawPayload;

        try {
            rawPayload =
                JSON.parse(payloadText);
        } catch {
            throw new Error(
                "Dane formularza mają nieprawidłowy format."
            );
        }

        const remoteIp =
            getRemoteIp(request);

        const turnstileResult =
            await verifyTurnstileToken(
                turnstileToken,
                remoteIp
            );

        if (!turnstileResult.success) {
            console.warn(
                "Turnstile rejected submission:",
                turnstileResult["error-codes"] || []
            );

            return jsonResponse(
                {
                    success: false,
                    error:
                        "Nie udało się potwierdzić zabezpieczenia. Spróbuj ponownie.",
                    code: "TURNSTILE_FAILED"
                },
                400
            );
        }

        const user =
            await getAuthenticatedUser(accessToken);

        const cleanPayload =
            validateReportPayload(rawPayload);

        const photos = formData
            .getAll("photos")
            .filter(item => item instanceof File);

        validatePhotos(photos);

        const insertResult =
            await supabaseRequest(
                "zgloszenia",
                {
                    method: "POST",
                    headers: {
                        "Content-Type":
                            "application/json",
                        Prefer:
                            "return=representation"
                    },
                    body: JSON.stringify({
                        ...cleanPayload,
                        status: "oczekuje",
                        submitted_by: user.id
                    }),
                    query: "?select=id"
                }
            );

        const report =
            Array.isArray(insertResult.data)
                ? insertResult.data[0]
                : insertResult.data;

        if (!report?.id) {
            throw new Error(
                "Baza nie zwróciła identyfikatora zgłoszenia."
            );
        }

        for (
            let index = 0;
            index < photos.length;
            index += 1
        ) {
            const photo = photos[index];

            const uploaded =
                await uploadPhoto(
                    photo,
                    user.id,
                    report.id,
                    index + 1
                );

            await supabaseRequest(
                "zdjecia",
                {
                    method: "POST",
                    headers: {
                        "Content-Type":
                            "application/json",
                        Prefer:
                            "return=minimal"
                    },
                    body: JSON.stringify({
                        zgloszenie_id: report.id,
                        sciezka:
                            uploaded.filePath,
                        url:
                            uploaded.publicUrl,
                        submitted_by: user.id
                    })
                }
            );
        }

        return jsonResponse(
            {
                success: true,
                message:
                    "Zgłoszenie zostało wysłane.",
                reportId: report.id
            },
            201
        );
    } catch (error) {
        console.error(
            "submit-report failed:",
            {
                message: error?.message,
                status: error?.status,
                details: error?.details
            }
        );

        const safeMessages = new Set([
            "Brak bezpiecznej sesji zgłoszenia.",
            "Sesja zgłoszenia jest nieprawidłowa lub wygasła.",
            "Dane formularza mają nieprawidłowy format.",
            "Możesz przesłać maksymalnie 3 zdjęcia.",
            "Łączny rozmiar zdjęć po kompresji jest zbyt duży.",
            "Wybierz osobę przekazującą informację.",
            "Wybierz dokładną datę wystąpienia zjawiska.",
            "Wybierz ogólny okres wystąpienia zjawiska."
        ]);

        const publicMessage =
            safeMessages.has(error?.message)
                ? error.message
                : error?.message?.startsWith("Pole „")
                    ? error.message
                    : error?.message?.startsWith("Plik „")
                        ? error.message
                        : "Nie udało się zapisać zgłoszenia.";

        return jsonResponse(
            {
                success: false,
                error: publicMessage
            },
            500
        );
    }
};