const test = require("node:test");
const assert = require("node:assert/strict");
const sms = require("../src/services/smsService");

test("Twilio integration sends encoded SMS and surfaces provider failures", async () => {
    const previous = {
        sid: process.env.TWILIO_ACCOUNT_SID, token: process.env.TWILIO_AUTH_TOKEN,
        from: process.env.TWILIO_FROM_NUMBER, fetch: global.fetch
    };
    process.env.TWILIO_ACCOUNT_SID = "test-sid";
    process.env.TWILIO_AUTH_TOKEN = "test-token";
    process.env.TWILIO_FROM_NUMBER = "+14155552670";
    try {
        global.fetch = async (url, options) => {
            assert.equal(url, "https://api.twilio.com/2010-04-01/Accounts/test-sid/Messages.json");
            assert.equal(options.body.get("To"), "+14155552671");
            assert.equal(options.body.get("From"), "+14155552670");
            assert.equal(options.body.get("Body"), "Test reminder");
            return { ok: true };
        };
        assert.equal(sms.configured(), true);
        await sms.sendSms("+14155552671", "Test reminder");
        global.fetch = async () => ({ ok: false, status: 400 });
        await assert.rejects(sms.sendSms("+14155552671", "Test reminder"), /HTTP 400/);
        process.env.TWILIO_FROM_NUMBER = "invalid";
        assert.equal(sms.configured(), false);
        await assert.rejects(sms.sendSms("+14155552671", "Test reminder"), /not configured/);
    } finally {
        for (const [key, value] of [["TWILIO_ACCOUNT_SID", previous.sid], ["TWILIO_AUTH_TOKEN", previous.token],
            ["TWILIO_FROM_NUMBER", previous.from]]) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
        global.fetch = previous.fetch;
    }
});
