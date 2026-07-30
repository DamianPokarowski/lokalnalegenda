export default async () => {
    return new Response(
        JSON.stringify({
            success: true,
            message: "Funkcja Netlify działa poprawnie.",
            timestamp: new Date().toISOString()
        }),
        {
            status: 200,
            headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": "no-store"
            }
        }
    );
};