function getSupabaseConfig() {
    const url = process.env.SUPABASE_URL;
    const secretKey = process.env.SUPABASE_SECRET_KEY;

    if (!url) {
        throw new Error("Brak zmiennej środowiskowej SUPABASE_URL.");
    }

    if (!secretKey) {
        throw new Error(
            "Brak zmiennej środowiskowej SUPABASE_SECRET_KEY."
        );
    }

    return {
        restUrl: `${url.replace(/\/$/, "")}/rest/v1`,
        secretKey
    };
}

export async function supabaseRequest(
    path,
    {
        method = "GET",
        headers = {},
        body,
        query = ""
    } = {}
) {
    const { restUrl, secretKey } = getSupabaseConfig();

    const normalizedPath = String(path).replace(/^\/+/, "");
    const url = `${restUrl}/${normalizedPath}${query}`;

    const response = await fetch(url, {
        method,
        headers: {
            apikey: secretKey,
            Accept: "application/json",
            ...headers
        },
        body
    });

    const responseText = await response.text();

    let data = null;

    if (responseText) {
        try {
            data = JSON.parse(responseText);
        } catch {
            data = responseText;
        }
    }

    if (!response.ok) {
        const error = new Error(
            `Supabase REST API zwróciło HTTP ${response.status}.`
        );

        error.status = response.status;
        error.details = data;
        throw error;
    }

    return {
        data,
        headers: response.headers,
        status: response.status
    };
}