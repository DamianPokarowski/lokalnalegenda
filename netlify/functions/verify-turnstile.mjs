import { verifyTurnstileToken } from "./lib/turnstile.mjs";

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

function getClientIp(request) {
    const forwardedFor = request.headers.get("x-forwarded-for");

    if (!forwardedFor) {
        return null;
    }

    return forwardedFor.split(",")[0].trim() || null;
}

export default async (request) => {
    if (request.method !== "POST") {
        return jsonResponse(
            {
                success: false,
                error: "Dozwolona jest wyłącznie metoda POST."
            },
            405
        );
    }

    let body;

    try {
        body = await request.json();
    } catch {
        return jsonResponse(
            {
                success: false,
                error: "Treść żądania nie jest poprawnym JSON-em."
            },
            400
        );
    }

    const token = body?.token;

    if (typeof token !== "string" || token.trim() === "") {
        return jsonResponse(
            {
                success: false,
                error: "Brak tokenu Turnstile."
            },
            400
        );
    }

    try {
        const verification = await verifyTurnstileToken(
            token,
            getClientIp(request)
        );

        if (!verification.success) {
            return jsonResponse(
                {
                    success: false,
                    error: "Weryfikacja Turnstile nie powiodła się.",
                    errorCodes: verification["error-codes"] ?? []
                },
                403
            );
        }

        const allowedHostnames = new Set([
            "lokalnalegenda.netlify.app"
        ]);

        if (!allowedHostnames.has(verification.hostname)) {
            console.warn(
                "Nieprawidłowy hostname Turnstile:",
                verification.hostname
            );

            return jsonResponse(
                {
                    success: false,
                    error: "Weryfikacja pochodzi z nieprawidłowej domeny."
                },
                403
            );
        }

        if (verification.action !== "submit_report") {
            console.warn(
                "Nieprawidłowa akcja Turnstile:",
                verification.action
            );

            return jsonResponse(
                {
                    success: false,
                    error: "Nieprawidłowy typ weryfikacji."
                },
                403
            );
        }

        return jsonResponse({
            success: true,
            message: "Token Turnstile został poprawnie zweryfikowany."
        });
    } catch (error) {
        console.error("Turnstile verification error:", error);

        return jsonResponse(
            {
                success: false,
                error: "Wystąpił błąd podczas weryfikacji zabezpieczenia."
            },
            500
        );
    }
};