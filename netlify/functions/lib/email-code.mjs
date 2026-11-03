import {
    createHmac,
    randomInt,
    randomUUID
} from "node:crypto";

import { supabaseRequest } from "./supabase.mjs";

export function normalizeEmail(value) {
    const email = String(value || "")
        .trim()
        .toLowerCase();

    if (
        email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
        throw new Error("Podaj poprawny adres e-mail.");
    }

    return email;
}

function digest(value) {
    const secret = process.env.EMAIL_CODE_SECRET;

    if (!secret || secret.length < 32) {
        throw new Error(
            "Brak poprawnej konfiguracji kodów e-mail."
        );
    }

    return createHmac("sha256", secret)
        .update(value)
        .digest("hex");
}

function emailKey(email) {
    return digest(`email:${normalizeEmail(email)}`);
}

function codeProof(id, userId, email, code) {
    return digest(
        JSON.stringify([
            "report-email-code",
            id,
            userId,
            emailKey(email),
            code
        ])
    );
}

export function createCode(userId, email, ip) {
    const id = randomUUID();

    // Zachowuje początkowe zera, np. 0047.
    const code = String(randomInt(0, 10000))
        .padStart(4, "0");

    return {
        id,
        code,
        reservation: {
            p_id: id,
            p_user_id: userId,
            p_email_key: emailKey(email),
            p_ip_key: digest(`ip:${ip}`),
            p_code_hash: codeProof(
                id,
                userId,
                email,
                code
            )
        }
    };
}

export function buildEmailConfirmation(value, userId) {
    if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value)
    ) {
        throw new Error(
            "Potwierdź adres e-mail kodem."
        );
    }

    const id = String(value.id || "");
    const code = String(value.code || "").trim();
    const email = normalizeEmail(value.email);

    const validId =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (
        !validId.test(id) ||
        !/^[0-9]{4}$/.test(code)
    ) {
        throw new Error(
            "Wpisz poprawny czterocyfrowy kod."
        );
    }

    return {
        id,
        proof: codeProof(
            id,
            userId,
            email,
            code
        )
    };
}

export async function callEmailRpc(name, payload) {
    const result = await supabaseRequest(
        `rpc/${name}`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        }
    );

    return result.data;
}

export async function authenticateSubmission(accessToken) {
    if (
        typeof accessToken !== "string" ||
        !accessToken.trim() ||
        accessToken.length > 8192
    ) {
        throw new Error(
            "Nieprawidłowa sesja formularza."
        );
    }

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;

    if (!url || !key) {
        throw new Error(
            "Brak konfiguracji Supabase."
        );
    }

    const response = await fetch(
        `${url.replace(/\/$/, "")}/auth/v1/user`,
        {
            headers: {
                apikey: key,
                Authorization:
                    `Bearer ${accessToken.trim()}`
            },
            signal: AbortSignal.timeout(10000)
        }
    );

    if (!response.ok) {
        throw new Error(
            "Nieprawidłowa sesja formularza."
        );
    }

    const user = await response.json();

    if (!user?.id) {
        throw new Error(
            "Nieprawidłowa sesja formularza."
        );
    }

    return user;
}

export async function sendCodeEmail(email, code) {
    const { default: nodemailer } =
        await import("nodemailer");

    const {
        SMTP_HOST,
        SMTP_PORT,
        SMTP_USER,
        SMTP_PASS,
        MAIL_FROM
    } = process.env;

    if (
        !SMTP_HOST ||
        !SMTP_PORT ||
        !SMTP_USER ||
        !SMTP_PASS ||
        !MAIL_FROM
    ) {
        throw new Error(
            "Brak konfiguracji poczty."
        );
    }

    const transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: Number(SMTP_PORT),
        secure: Number(SMTP_PORT) === 465,
        auth: {
            user: SMTP_USER,
            pass: SMTP_PASS
        },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000
    });

    await transporter.sendMail({
        from: MAIL_FROM,
        to: email,
        subject:
            "LokalnaLegenda — kod potwierdzający zgłoszenie",
        text: [
            "Twój kod potwierdzający zgłoszenie:",
            "",
            code,
            "",
            "Kod jest ważny przez 10 minut od wygenerowania.",
            "Wpisz go w formularzu, aby wysłać zgłoszenie.",
            "",
            "Jeżeli nie proszono o ten kod, zignoruj wiadomość.",
            "",
            "LokalnaLegenda.pl"
        ].join("\n")
    });
}