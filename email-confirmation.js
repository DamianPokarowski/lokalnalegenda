(() => {
    const emailInput = document.querySelector("#submission-email");
    const codeInput = document.querySelector("#submission-email-code");
    const sendButton = document.querySelector("#send-email-code");
    const message = document.querySelector("#email-code-message");
    const placeForm = document.querySelector("#place-form");
    const submitButton = document.querySelector("#submit-btn");

    let challenge = null;
    let sending = false;
    let submitting = false;
    let resendAt = 0;

    function normalizedEmail() {
        return emailInput.value.trim().toLowerCase();
    }

    function showEmailMessage(text, error = false) {
        message.textContent = text;
        message.style.color = error ? "#ff8c8c" : "#ffe8a6";
    }

    function updateSendButton() {
        const seconds = Math.max(
            0,
            Math.ceil((resendAt - Date.now()) / 1000)
        );

        sendButton.disabled = sending || submitting || seconds > 0;

        sendButton.textContent = sending
            ? "Wysyłanie kodu..."
            : seconds > 0
                ? `Wyślij ponownie za ${seconds} s`
                : "Wyślij kod na e-mail";
    }

    window.getSubmissionEmailConfirmation = () => {
        if (
            !challenge ||
            challenge.email !== normalizedEmail()
        ) {
            throw new Error(
                "Najpierw wyślij kod na podany adres e-mail."
            );
        }

        if (Date.now() >= challenge.expiresAt) {
            throw new Error(
                "Kod wygasł. Wyślij nowy kod na e-mail."
            );
        }

        const code = codeInput.value.trim();

        if (!/^[0-9]{4}$/.test(code)) {
            throw new Error(
                "Wpisz czterocyfrowy kod z wiadomości."
            );
        }

        return {
            id: challenge.id,
            email: challenge.email,
            code
        };
    };

    emailInput.addEventListener("input", () => {
        challenge = null;
        codeInput.value = "";

        showEmailMessage(
            "Po zmianie adresu wyślij nowy kod."
        );
    });

    sendButton.addEventListener("click", async () => {
        if (sending || submitting || Date.now() < resendAt) {
            return;
        }

        if (!emailInput.reportValidity()) {
            return;
        }

        const token = document.querySelector(
            'input[name="cf-turnstile-response"]'
        )?.value?.trim();

        if (!token) {
            showEmailMessage(
                "Najpierw potwierdź poniżej, że nie jesteś robotem.",
                true
            );
            return;
        }

        const email = normalizedEmail();

        sending = true;
        emailInput.readOnly = true;
        submitButton.disabled = true;
        updateSendButton();

        try {
            const session = await ensureSubmissionSession();

            const response = await fetch(
                "/.netlify/functions/request-email-code",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        email,
                        accessToken: session.access_token,
                        turnstileToken: token
                    })
                }
            );

            let result;

            try {
                result = await response.json();
            } catch {
                throw new Error(
                    "Serwer zwrócił nieprawidłową odpowiedź. Sprawdź wdrożenie w Netlify."
                );
            }

            if (!response.ok || !result.success) {
                throw new Error(
                    result.error || "Nie udało się wysłać kodu."
                );
            }

            challenge = {
                id: result.challengeId,
                email,
                expiresAt: Date.now() + result.expiresIn * 1000
            };

            codeInput.value = "";
            resendAt = Date.now() + result.resendAfter * 1000;

            showEmailMessage(
                "Kod został wysłany. Sprawdź także folder Spam. " +
                "Wpisz kod i ponownie potwierdź zabezpieczenie przed wysłaniem zgłoszenia."
            );

            codeInput.focus();
        } catch (error) {
            showEmailMessage(
                error.message || "Nie udało się wysłać kodu.",
                true
            );
        } finally {
            resetTurnstileWidget();

            sending = false;
            emailInput.readOnly = false;
            submitButton.disabled = false;
            updateSendButton();
        }
    });

    placeForm.addEventListener("submit", event => {
        if (sending || submitting) {
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
        }

        try {
            window.getSubmissionEmailConfirmation();
        } catch (error) {
            event.preventDefault();
            event.stopImmediatePropagation();

            showEmailMessage(error.message, true);
        }
    }, true);

    window.setEmailSubmissionBusy = busy => {
        submitting = busy;
        emailInput.readOnly = busy;
        codeInput.readOnly = busy;
        updateSendButton();
    };

    placeForm.addEventListener("reset", () => {
        challenge = null;
        codeInput.value = "";
        showEmailMessage("");
    });

    setInterval(updateSendButton, 1000);
    updateSendButton();
})();