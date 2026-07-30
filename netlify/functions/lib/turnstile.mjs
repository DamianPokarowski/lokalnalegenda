const TURNSTILE_VERIFY_URL =
    "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Weryfikuje jednorazowy token Cloudflare Turnstile.
 *
 * @param {string} token Token otrzymany z widgetu Turnstile.
 * @param {string | null} remoteIp Adres IP użytkownika, jeśli jest dostępny.
 * @returns {Promise<object>} Odpowiedź Cloudflare Siteverify.
 */
export async function verifyTurnstileToken(token, remoteIp = null) {
    if (typeof token !== "string" || token.trim() === "") {
        return {
            success: false,
            "error-codes": ["missing-input-response"]
        };
    }

    const secretKey = Netlify.env.get("TURNSTILE_SECRET_KEY");

    if (!secretKey) {
        throw new Error(
            "Brak zmiennej środowiskowej TURNSTILE_SECRET_KEY."
        );
    }

    const payload = new URLSearchParams({
        secret: secretKey,
        response: token.trim()
    });

    if (remoteIp) {
        payload.set("remoteip", remoteIp);
    }

    const response = await fetch(TURNSTILE_VERIFY_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: payload
    });

    if (!response.ok) {
        throw new Error(
            `Cloudflare Siteverify zwrócił HTTP ${response.status}.`
        );
    }

    return await response.json();
}