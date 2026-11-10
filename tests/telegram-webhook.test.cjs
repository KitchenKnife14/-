const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../telegram-webhook/handler.ts'), 'utf8');
const javascript = ts.transpile(source, {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022,
});

const ENV = {
  TELEGRAM_WEBHOOK_SECRET: 'w'.repeat(40),
  TELEGRAM_BACKEND_SECRET: 'b'.repeat(40),
  TELEGRAM_BOT_TOKEN: '123456:fake-test-token',
  TELEGRAM_APPS_SCRIPT_URL: 'https://script.google.com/macros/s/test-deployment/exec',
};

function setup(fetchImpl, env = ENV) {
  const module = { exports: {} };
  const context = {
    module,
    exports: module.exports,
    process: { env },
    fetch: fetchImpl,
    URL,
  };
  context.globalThis = context;
  vm.runInNewContext(javascript, context, { filename: 'telegram-webhook/handler.ts' });
  return module.exports.default;
}

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    setHeader(name, value) { this.headers[name] = value; },
  };
}

function request(overrides = {}) {
  return {
    method: 'POST',
    headers: { 'x-telegram-bot-api-secret-token': ENV.TELEGRAM_WEBHOOK_SECRET },
    body: { update_id: 1, message: { chat: { id: 123, type: 'private' } } },
    ...overrides,
  };
}

test('webhook rejects non-POST methods and advertises Allow: POST', async () => {
  const handler = setup(async () => { throw new Error('fetch must not run'); });
  const res = response();
  await handler(request({ method: 'GET' }), res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'POST');
});

test('webhook refuses incomplete environment configuration', async () => {
  const handler = setup(async () => { throw new Error('fetch must not run'); }, {});
  const res = response();
  await handler(request(), res);
  assert.equal(res.statusCode, 503);
});

test('webhook rejects an invalid Telegram secret before calling backend', async () => {
  let calls = 0;
  const handler = setup(async () => { calls++; });
  const res = response();
  await handler(request({ headers: { 'x-telegram-bot-api-secret-token': 'wrong' } }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(calls, 0);
});

test('webhook rejects invalid Apps Script endpoint configuration', async () => {
  const handler = setup(async () => { throw new Error('fetch must not run'); }, {
    ...ENV, TELEGRAM_APPS_SCRIPT_URL: 'https://example.com/exec',
  });
  const res = response();
  await handler(request(), res);
  assert.equal(res.statusCode, 503);
});

test('webhook rejects malformed JSON without calling backend', async () => {
  let calls = 0;
  const handler = setup(async () => { calls++; });
  const res = response();
  await handler(request({ body: '{invalid json' }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(calls, 0);
});

test('webhook returns 502 when Apps Script responds with a non-2xx status', async () => {
  const handler = setup(async () => ({ ok: false, text: async () => '' }));
  const res = response();
  await handler(request(), res);
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'Webhook processing failed; Telegram may retry safely');
});

test('webhook returns 502 when Apps Script response is not JSON', async () => {
  const handler = setup(async () => ({ ok: true, text: async () => '<html>login</html>' }));
  const res = response();
  await handler(request(), res);
  assert.equal(res.statusCode, 502);
});

test('webhook forwards backend replies to Telegram and acknowledges success', async () => {
  const calls = [];
  const handler = setup(async (url, options) => {
    calls.push({ url, options });
    if (url === ENV.TELEGRAM_APPS_SCRIPT_URL) {
      return { ok: true, text: async () => JSON.stringify({ data: { chat_id: 123, text: 'Записал расход' } }) };
    }
    return { ok: true, json: async () => ({ ok: true }) };
  });
  const res = response();
  await handler(request(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.redirect, 'follow');
  assert.equal(JSON.parse(calls[1].options.body).text, 'Записал расход');
});

test('webhook sends a safe backend error message to Telegram', async () => {
  const sent = [];
  const handler = setup(async (url, options) => {
    if (url === ENV.TELEGRAM_APPS_SCRIPT_URL) {
      return { ok: true, text: async () => JSON.stringify({ error: { message: 'Не понял сумму' } }) };
    }
    sent.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ ok: true }) };
  });
  const res = response();
  await handler(request(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, 'Не понял сумму');
});

test('webhook acknowledges skipped updates without sending Telegram messages', async () => {
  let telegramCalls = 0;
  const handler = setup(async url => {
    if (url === ENV.TELEGRAM_APPS_SCRIPT_URL) {
      return { ok: true, text: async () => JSON.stringify({ data: { skip: true } }) };
    }
    telegramCalls++;
    return { ok: true, json: async () => ({ ok: true }) };
  });
  const res = response();
  await handler(request(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(telegramCalls, 0);
});

test('webhook returns 502 when Telegram rejects sendMessage', async () => {
  const handler = setup(async url => {
    if (url === ENV.TELEGRAM_APPS_SCRIPT_URL) {
      return { ok: true, text: async () => JSON.stringify({ data: { chat_id: 123, text: 'Ответ' } }) };
    }
    return { ok: false, json: async () => ({ ok: false, description: 'blocked' }) };
  });
  const res = response();
  await handler(request(), res);
  assert.equal(res.statusCode, 502);
});



test('webhook retries an uncertain send at-least-once with the same update and reply', async () => {
  const sentMessages = [];
  const backendUpdates = [];
  let telegramAttempts = 0;
  const handler = setup(async (url, options) => {
    if (url === ENV.TELEGRAM_APPS_SCRIPT_URL) {
      backendUpdates.push(JSON.parse(options.body).update.update_id);
      return {
        ok: true,
        text: async () => JSON.stringify({
          data: { chat_id: 123, text: 'Записал расход: 45,00 ₽ — Проезд' },
        }),
      };
    }

    telegramAttempts++;
    const message = JSON.parse(options.body);
    // Model Telegram accepting the message while the HTTP response is lost.
    sentMessages.push(message);
    if (telegramAttempts === 1) throw new Error('Connection lost after remote acceptance');
    return { ok: true, json: async () => ({ ok: true }) };
  });

  const firstResponse = response();
  await handler(request(), firstResponse);
  assert.equal(firstResponse.statusCode, 502);

  const retryResponse = response();
  await handler(request(), retryResponse);
  assert.equal(retryResponse.statusCode, 200);

  assert.deepEqual(backendUpdates, [1, 1]);
  assert.equal(telegramAttempts, 2);
  assert.equal(sentMessages.length, 2);
  assert.equal(sentMessages[0].text, sentMessages[1].text);
  assert.equal(sentMessages[0].chat_id, sentMessages[1].chat_id);
});
