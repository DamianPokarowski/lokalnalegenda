import { supabaseRequest } from "./lib/supabase.mjs";

const JSON_HEADERS = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
};

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: JSON_HEADERS
    });
}

export default async (request) => {
    if (request.method !== "GET") {
        return jsonResponse(
            {
                success: false,
                error: "Dozwolona jest wyłącznie metoda GET."
            },
            405
        );
    }

    try {
        const result = await supabaseRequest(
            "historia",
            {
                method: "GET",
                headers: {
                    Prefer: "count=exact"
                },
                query: "?select=id&limit=1"
            }
        );

        const contentRange =
            result.headers.get("content-range") || "";

        const match = contentRange.match(/\/(\d+)$/);

        const publishedCount = match
            ? Number(match[1])
            : null;

        return jsonResponse({
            success: true,
            message:
                "Połączenie backendu z Supabase działa poprawnie.",
            publishedCount
        });
    } catch (error) {
        console.error("Supabase connection test failed:", {
            message: error.message,
            status: error.status,
            details: error.details
        });

        return jsonResponse(
            {
                success: false,
                error:
                    "Nie udało się połączyć z bazą danych."
            },
            500
        );
    }
};