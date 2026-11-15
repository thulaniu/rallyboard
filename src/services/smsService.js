function configured() {
    return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN &&
        /^\+[1-9]\d{1,14}$/.test(process.env.TWILIO_FROM_NUMBER || ""));
}

async function sendSms(to, body) {
    if (!configured()) throw new Error("SMS provider is not configured.");
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
        method: "POST",
        headers: {
            Authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM_NUMBER, Body: body }),
        signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`SMS provider rejected the request (HTTP ${response.status}).`);
}

module.exports = { configured, sendSms };
