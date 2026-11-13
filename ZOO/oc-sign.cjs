// Подпись запросов к шлюзу OpenCoder (ed25519-v1) как замена fetch.
// Формат подписи полностью совпадает с gw-proxy.mjs (см. signedHeaders).
//
// Зачем CJS: этот файл подключается через require() из бандла Zoo Code (dist/extension.js),
// а бандл — CommonJS. Никакого сервера, портов и фоновых процессов: подпись считается
// в момент отправки запроса внутри процесса расширения.
'use strict';
const { createHash, createPrivateKey, sign, randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const GW_HOST = 'code.accelstacks.com';
const CRED_PATH = path.join(process.env.LOCALAPPDATA || '', 'OpenCoder', 'cc-web-credentials.json');

// Отпечаток сборки OpenCoder (x-ccw-build). Пустой допустим — шлюз такой запрос принимает.
const BUILD_SHA = (() => {
  try {
    const home = (process.env.OPENCODER_HOME || '').trim().replace(/[\\/]+$/, '') || 'C:\\OpenCoder';
    return createHash('sha256').update(readFileSync(path.join(home, 'cli.js'))).digest('hex');
  } catch {
    return '';
  }
})();

// Читаем на каждый запрос: token ротируется, кэш дал бы 401.
const creds = () => JSON.parse(readFileSync(CRED_PATH, 'utf8')).credentials['https://' + GW_HOST + '/gw'];

// Каноническая строка: тот же порядок и разделитель, что проверяет шлюз.
function signedHeaders(cred, urlStr, method, bodyBytes) {
  const url = new URL(urlStr);
  const timestamp = String(Math.floor(Date.now()));
  const nonce = randomBytes(24).toString('base64url');
  const contentSha = createHash('sha256').update(bodyBytes).digest('base64url');
  const canonical = [
    'CCW-OPENCODER-REQUEST',
    '1',
    cred.tokenId,
    timestamp,
    nonce,
    method,
    url.pathname + url.search,
    contentSha,
    BUILD_SHA,
  ].join('\n');
  const key = createPrivateKey({
    key: Buffer.from(cred.requestSigningPrivateKey, 'base64url'),
    format: 'der',
    type: 'pkcs8',
  });
  const signature = sign(null, Buffer.from(canonical, 'utf8'), key).toString('base64url');
  return {
    authorization: 'Bearer ' + cred.accessToken,
    'x-ccw-request-version': '1',
    'x-ccw-request-timestamp': timestamp,
    'x-ccw-request-nonce': nonce,
    'x-ccw-content-sha256': contentSha,
    'x-ccw-request-signature': signature,
    'x-ccw-build': BUILD_SHA,
  };
}

// Тело нужно целиком в байтах: по нему считается x-ccw-content-sha256.
async function toBytes(v) {
  if (v == null) return Buffer.alloc(0);
  if (Buffer.isBuffer(v)) return v;
  if (typeof v === 'string') return Buffer.from(v, 'utf8');
  if (v instanceof Uint8Array) return Buffer.from(v);
  if (v instanceof URLSearchParams) return Buffer.from(v.toString(), 'utf8');
  if (v instanceof ArrayBuffer) return Buffer.from(v);
  if (typeof v.arrayBuffer === 'function') return Buffer.from(await v.arrayBuffer());
  return Buffer.from(String(v), 'utf8');
}

function isGateway(urlStr) {
  try {
    return new URL(urlStr).host === GW_HOST;
  } catch {
    return false;
  }
}

// Drop-in замена fetch: шлюз подписываем, всё остальное уходит без изменений.
// Важно: остальные провайдеры Zoo (OpenAI, Anthropic и т.д.) не затрагиваются.
async function ocSignFetch(input, init) {
  const isReq = typeof Request !== 'undefined' && input instanceof Request;
  const urlStr = isReq ? input.url : String(input);
  if (!isGateway(urlStr)) return fetch(input, init);

  const opts = init || {};
  const method = String(opts.method || (isReq ? input.method : 'GET')).toUpperCase();
  // Если пришёл Request, тело и заголовки лежат в нём.
  const rawBody = opts.body !== undefined ? opts.body : isReq ? await input.clone().arrayBuffer() : null;
  const body = await toBytes(rawBody);

  const headers = new Headers(isReq ? input.headers : undefined);
  if (opts.headers) new Headers(opts.headers).forEach((v, k) => headers.set(k, v));
  // Подпись ставим последней — SDK не должен её перетереть.
  for (const [k, v] of Object.entries(signedHeaders(creds(), urlStr, method, body))) headers.set(k, v);

  const out = { ...opts, method, headers };
  if (body.length) out.body = body;
  else delete out.body;
  return fetch(urlStr, out);
}

module.exports = { ocSignFetch };
module.exports.default = ocSignFetch;
module.exports.signedHeaders = signedHeaders;
