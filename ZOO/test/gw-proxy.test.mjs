// Смоук-тест gw-proxy: поднимает прокси на тестовом порту и проверяет,
// что сквозной запрос /v1/models до шлюза отвечает 200 и списком моделей.
// Запуск: node --test test/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PROXY_SCRIPT = path.join(ROOT, 'gw-proxy.mjs');
const CRED_PATH =
  process.env.LOCALAPPDATA + '\\OpenCoder\\cc-web-credentials.json';
const TEST_PORT = 18787;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}/v1`;

let child = null;

function waitUntilListening(port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    (function tryConnect() {
      const sock = net.connect(port, '127.0.0.1');
      sock.once('connect', () => {
        sock.end();
        resolve();
      });
      sock.once('error', () => {
        sock.destroy();
        if (Date.now() - started > timeoutMs) reject(new Error('прокси не поднялся'));
        else setTimeout(tryConnect, 300);
      });
    })();
  });
}

before(async () => {
  if (!existsSync(CRED_PATH)) {
    console.log('skip: нет креденшалов OpenCoder — смоук-тест невозможен');
    process.exit(0);
  }
  child = spawn(process.execPath, [PROXY_SCRIPT], {
    env: { ...process.env, GW_PROXY_PORT: String(TEST_PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => process.stderr.write('[proxy] ' + d));
  await waitUntilListening(TEST_PORT, 30000);
});

after(() => {
  if (child) child.kill();
});

test('GET /v1/models отдаёт список моделей шлюза', async () => {
  const res = await fetch(BASE_URL + '/models', {
    headers: { authorization: 'Bearer local' },
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  const ids = data.data.map((m) => m.id);
  assert.ok(ids.includes('pro'), 'должна быть модель pro');
  assert.ok(ids.includes('flash'), 'должна быть модель flash');
});
