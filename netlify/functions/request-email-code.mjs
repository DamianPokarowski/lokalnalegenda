import { verifyTurnstileToken } from "./lib/turnstile.mjs";

import {
    normalizeEmail,
    createCode,
    callEmailRpc,
    authenticateSubmission,
    sendCodeEmail
} from "./lib/email-code.mjs";

function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store"
        }
    });
}

export default async request => {
    if (request.method !== "POST") {
        return json({
            success: false,
            error: "Dozwolona jest wyłącznie metoda POST."
        }, 405);
    }

    try {
        const text = await request.text();

        if (text.length > 12000) {
            return json({
                success: false,
                error: "Zbyt duże żądanie."
            }, 413);
        }

        let input;

        try {
            input = JSON.parse(text);
        } catch {
            return json({
                success: false,
                error: "Nieprawidłowy format danych."
            }, 400);
        }

        if (!input || typeof input !== "object") {
            return json({
                success: false,
                error: "Nieprawidłowy format danych."
            }, 400);
        }

        let email;

        try {
            email = normalizeEmail(input.email);
        } catch {
            return json({
                success: false,
                error: "Podaj poprawny adres e-mail."
            }, 400);
        }

        // Na Netlify korzystamy z nagłówka ustawianego przez platformę.
        const ip = request.headers.get(
            "x-nf-client-connection-ip"
        );

        if (!ip) {
            return json({
                success: false,
                error: "Nie udało się sprawdzić połączenia. Spróbuj na opublikowanej stronie."
            }, 400);
        }

        const security = await verifyTurnstileToken(
            input.turnstileToken,
            ip
        );

        if (
            !security.success ||
            security.action !== "submit_report"
        ) {
            return json({
                success: false,
                error: "Potwierdź ponownie, że nie jesteś robotem."
            }, 400);
        }

        let user;

        try {
            user = await authenticateSubmission(input.accessToken);
        } catch {
            return json({
                success: false,
                error: "Sesja wygasła. Odśwież stronę i spróbuj ponownie."
            }, 401);
        }

        const challenge = createCode(user.id, email, ip);

        const reservation = await callEmailRpc(
            "ll_reserve_email_code",
            challenge.reservation
        );

        if (!reservation?.ok) {
            return json({
                success: false,
                error: reservation?.error ||
                    "Nie można teraz wysłać kodu."
            }, 429);
        }

        await sendCodeEmail(email, challenge.code);

        await callEmailRpc("ll_activate_email_code", {
            p_id: challenge.id
        });

        return json({
            success: true,
            challengeId: challenge.id,
            expiresIn: 600,
            resendAfter: 60
        });
    } catch {
        // Nie zapisujemy w logach adresu, kodu ani hasła SMTP.
        console.error("request-email-code: nie udało się wysłać kodu");

        return json({
            success: false,
            error: "Nie udało się wysłać kodu. Spróbuj ponownie za minutę."
        }, 500);
    }
};