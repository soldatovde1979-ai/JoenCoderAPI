// Локальный OpenAI-совместимый прокси к шлюзу OpenCoder с подписью запросов (ed25519-v1).
// Roo Code -> http://127.0.0.1:8787/v1 (любой Bearer-ключ) -> переподпись -> https://code.accelstacks.com/gw/v1
// Запуск: node gw-proxy.mjs  (или gw-proxy.cmd — проверит окружение и при необходимости поставит Node)
import { createHash, createPrivateKey, sign, randomBytes } from 'node:crypto';
import { readFileSync, appendFileSync, existsSync, renameSync, statSync } from 'node:fs';
import http from 'node:http';
import { Readable } from 'node:stream';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { format } from 'node:util';

const SCRIPT_PATH = fileURLToPath(import.meta.url);

const GW_BASE = 'https://code.accelstacks.com';
const CRED_PATH = process.env.LOCALAPPDATA + '\\OpenCoder\\cc-web-credentials.json';
// Каталог установки OpenCoder. По умолчанию C:\OpenCoder; если OpenCoder стоит в другом
// месте — задайте OPENCODER_HOME (проще всего строкой set в gw-proxy.cmd).
const OPENCODER_HOME = (process.env.OPENCODER_HOME || '').trim().replace(/[\\/]+$/, '') || 'C:\\OpenCoder';
const CLI_PATH = path.join(OPENCODER_HOME, 'cli.js');
const PORT = Number(process.env.GW_PROXY_PORT || 8787);
// Сколько ждать заголовков от шлюза. Стриминг ответа после заголовков не ограничен.
const UPSTREAM_TIMEOUT_MS = Number(process.env.GW_PROXY_TIMEOUT_MS || 60000);
// debug=: 0 — без логов запросов, 1 — только ошибки (по умолчанию), 2 — все запросы.
// Задаётся аргументом (node gw-proxy.mjs debug=2) или переменной GW_PROXY_DEBUG.
const DEBUG = (() => {
  const a = process.argv.find((x) => /^debug=[0-2]$/.test(x));
  const v = (a ? a.slice(6) : process.env.GW_PROXY_DEBUG || '').trim();
  return v === '' ? 1 : Number(v) || 0;
})();
const BASE_URL = `http://127.0.0.1:${PORT}/v1`;
const PROFILES = [
  { name: 'OC', model: 'flash', note: 'быстрая модель' },
  { name: 'OC PRO', model: 'pro', note: 'тяжёлая модель' },
  { name: 'OC PRO+', model: 'pro', note: 'то же, Reasoning Effort = High' },
];
const ROO_EXT_ID = 'rooveterinaryinc.roo-cline';
const ZOO_EXT_ID = 'zoocodeorganization.zoo-code'; // форк Roo — тот же формат конфига

const ok = (s) => `\x1b[32m[OK]\x1b[0m ${s}`;
const warn = (s) => `\x1b[33m[!!]\x1b[0m ${s}`;
const info = (s) => `     ${s}`;

/* ================= Лог: метка времени, чистый текст в файле, живой режим в консоли ================= */

const LOG_PATH = path.join(path.dirname(SCRIPT_PATH), 'gw-proxy.log');
const LOG_PREV_PATH = path.join(path.dirname(SCRIPT_PATH), 'gw-proxy.prev.log');
const LOG_MAX_BYTES = 1024 * 1024; // 1 МБ: больший лог при старте уходит в gw-proxy.prev.log
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g; // ANSI-коды цвета — они и выглядят «кракозябрами» в cmd
const ts = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
// Лог ведёт сам прокси, независимо от способа запуска. Раньше он обрезался до последних
// 200 строк при каждом старте — следы сбоя терялись. Теперь лог переименовывается
// в gw-proxy.prev.log только когда превысил 1 МБ, поэтому причина ошибки переживает рестарт.
if (existsSync(LOG_PATH)) {
  try {
    if (statSync(LOG_PATH).size > LOG_MAX_BYTES) renameSync(LOG_PATH, LOG_PREV_PATH);
  } catch {} // лог не читается/не переименовывается — не критично, продолжаем
}
function emit(stream, args) {
  const stamp = `[${ts()}] `;
  const msg = format(...args);
  stream.write(stamp + msg + '\n'); // в консоль — как есть, с цветом
  try { appendFileSync(LOG_PATH, stamp + msg.replace(ANSI_RE, '') + '\n'); } catch {}
  // в файл — чистый текст без ANSI-кодов (они и выглядели «кракозябрами»)
}
console.log = (...a) => emit(process.stdout, a);
console.warn = (...a) => emit(process.stderr, a);
console.error = (...a) => emit(process.stderr, a);

let BUILD_SHA = '';
let CLI_FOUND = false;
try {
  BUILD_SHA = createHash('sha256').update(readFileSync(CLI_PATH)).digest('hex');
  CLI_FOUND = true;
} catch {
  // Допустимо: шлюз принимает пустой x-ccw-build. Но путь стоит проверить —
  // если OpenCoder установлен в другой каталог, задайте OPENCODER_HOME.
  console.warn(warn(`cli.js OpenCoder не найден: ${CLI_PATH} (x-ccw-build будет пустым)`));
  console.warn(info('→ Если OpenCoder установлен в другом каталоге — задайте OPENCODER_HOME.'));
}
const creds = () =>
  JSON.parse(readFileSync(CRED_PATH, 'utf8')).credentials['https://code.accelstacks.com/gw'];

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

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

/* ================= Preflight: проверки окружения ================= */

function checkNode() {
  const [maj] = process.versions.node.split('.').map(Number);
  if (maj < 18) {
    console.warn(warn(`Node.js ${process.versions.node} — староват, нужен >= 18.`));
  } else {
    console.log(ok(`Node.js ${process.versions.node}`));
  }
}

function checkCredentials() {
  if (!existsSync(CRED_PATH)) {
    console.warn(warn('Креденшалы OpenCoder не найдены: ' + CRED_PATH));
    console.warn(info('→ Запусти и войди в OpenCoder CLI, затем перезапусти прокси.'));
    process.exit(1);
  }
  try {
    const c = creds();
    if (!c.requestSigningPrivateKey) throw new Error('legacy credential без ключа подписи');
    console.log(ok('Креденшалы OpenCoder найдены (managed device)'));
  } catch {
    console.warn(warn('Креденшалы устарели или повреждены. Переустанови OpenCoder с дашборда.'));
    process.exit(1);
  }
}

function checkVscodeRoo() {
  let codeCli = null;
  for (const c of ['code', 'code.cmd']) {
    try {
      execSync(`where ${c}`, { stdio: 'pipe' });
      codeCli = c;
      break;
    } catch {}
  }
  if (!codeCli) {
    console.warn(warn('VS Code / CLI "code" не найден — поставь VS Code и расширение Roo Code.'));
    return;
  }
  let list = '';
  try {
    list = execSync(`${codeCli} --list-extensions`, { encoding: 'utf8', timeout: 30000 });
  } catch {
    console.warn(warn('Не удалось выполнить "code --list-extensions" — пропускаю проверку Roo.'));
    return;
  }
  const exts = list.toLowerCase();
  if (exts.includes(ROO_EXT_ID.toLowerCase())) {
    console.log(ok('Roo Code установлен'));
    checkRooProfiles('RooVeterinaryInc.roo-cline').catch(() => {});
  } else if (exts.includes(ZOO_EXT_ID)) {
    console.log(ok('Обнаружен Zoo Code (форк Roo Code) — настройка профилей та же'));
    checkRooProfiles(ZOO_EXT_ID).catch(() => {});
  } else {
    console.warn(warn('Roo Code не установлен. Устанавливаю...'));
    const r = spawnSync(codeCli, ['--install-extension', ROO_EXT_ID, '--force'], {
      encoding: 'utf8',
      timeout: 120000,
    });
    if (r.status === 0) console.log(ok('Roo Code установлен — перезапусти VS Code, если он был открыт'));
    else {
      console.warn(info(`Автоматика не прошла (код ${r.status}). Вручную: ${codeCli} --install-extension ${ROO_EXT_ID}`));
      if (r.stderr) console.warn(info(String(r.stderr).trim().slice(0, 200)));
    }
  }
}

async function checkRooProfiles(stateKey) {
  // Профили Roo хранятся в state.vscdb (читаем; сами ключи шифруются VS Code — их не трогаем)
  const dbPath = process.env.APPDATA + '\\Code\\User\\globalStorage\\state.vscdb';
  if (!existsSync(dbPath)) return;
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const row = db.prepare("SELECT value FROM ItemTable WHERE key = ?").get(stateKey);
    db.close();
    const state = row ? JSON.parse(row.value) : {};
    const names = (state.listApiConfigMeta || []).map((p) => p.name);
    const missing = PROFILES.filter((p) => !names.includes(p.name));
    if (missing.length === 0) {
      console.log(ok('Профили Roo настроены: ' + PROFILES.map((p) => p.name).join(', ')));
    } else {
      console.warn(warn('В Roo нет профилей: ' + missing.map((p) => p.name).join(', ')));
      console.warn(info('Настройка — Roo Code → Settings → Provider → OpenAI Compatible:'));
      for (const p of PROFILES) {
        console.warn(
          info(
            `• "${p.name}" — Base URL: ${BASE_URL} | API Key: local | Model: ${p.model} (${p.note})`
          )
        );
      }
    }
  } catch {
    console.warn(info('Профили Roo не проверены (нет node:sqlite или база занята) — не критично.'));
  }
}

function checkAutostart() {
  let enabled = false;
  try {
    const out = execSync('schtasks /query /tn "gw-proxy"', { encoding: 'utf8', stdio: 'pipe' });
    enabled = out.includes('gw-proxy');
  } catch {}
  console.log(info('')); // пустая строка-разделитель
  if (enabled) {
    console.log(ok('Автозапуск: включён (задача планировщика "gw-proxy")'));
    console.warn(info('Выключить: schtasks /delete /tn "gw-proxy" /f'));
  } else {
    console.warn(warn('Автозапуск: не настроен — прокси надо запускать вручную.'));
    console.warn(info('Включить: schtasks /create /tn "gw-proxy" /tr "node ' + SCRIPT_PATH + '" /sc onlogon /rl limited /f'));
    console.warn(info('Или ярлык на этот файл в shell:startup'));
  }
}

/* ================= HTTP-сервер ================= */

// Диагностика зависаний: считаем запросы «в полёте» (получен клиентом, но ещё не завершён).
// В логе видно: START (приём) → ждёт шлюз N сек → завершение. Если запросов несколько —
// они обрабатываются параллельно (Node однопоточный, ожидание ответа шлюза друг друга не блокирует).
let inFlight = 0;

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  inFlight++;
  const startLine = `[start] #${inFlight} ${req.method} ${req.url}`;
  if (DEBUG >= 2) console.log(startLine + (inFlight > 1 ? ` (параллельно: ${inFlight})` : ''));
  // Итог запроса считаем по фактическому закрытию ответа: у стрима это видно только здесь —
  // по этой строке определяется реальная длительность и обрыв со стороны клиента.
  res.on('close', () => {
    inFlight = Math.max(0, inFlight - 1);
    if (DEBUG >= 2) console.log(`[done] ${req.method} ${req.url} (${Date.now() - started} ms, осталось в полёте: ${inFlight})`);
    if (res.headersSent && !res.writableFinished)
      console.error(`[err] клиент прервал ответ: ${req.method} ${req.url} (${Date.now() - started} ms)`);
  });
  try {
    const body = await readBody(req);
    const upstreamUrl = GW_BASE + '/gw' + req.url; // /v1/... -> /gw/v1/...
    const method = req.method.toUpperCase();
    const doFetch = (cred) => {
      // Тайм-аут действует только до получения заголовков: зависший апстрим
      // отдаёт клиенту 502 вместо вечного ожидания. Стриминг тела не ограничен.
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS);
      return fetch(upstreamUrl, {
        method,
        headers: {
          ...signedHeaders(cred, upstreamUrl, method, body),
          ...(body.length && { 'content-type': req.headers['content-type'] || 'application/json' }),
          ...(req.headers.accept && { accept: req.headers.accept }),
        },
        ...(body.length && { body }),
        signal: ac.signal,
      }).finally(() => clearTimeout(timer));
    };

    let upstream = await doFetch(creds());
    if (upstream.status === 401) {
      // креденшал мог ротироваться — перечитать и переподписать один раз
      upstream = await doFetch(creds());
    }

    const waitedMs = Date.now() - started; // сколько шлюз думал до первых байтов (заголовков)
    const statusLine = `${method} ${req.url} -> ${upstream.status} (шлюз ${waitedMs} ms, всего ${Date.now() - started} ms)`;
    const contentType = upstream.headers.get('content-type') || 'application/json';
    const headers = { 'content-type': contentType };
    if (upstream.headers.get('cache-control')) headers['cache-control'] = upstream.headers.get('cache-control');
    // Долгое ожидание заголовков от шлюза — типичная причина «зависания» у агента.
    // Пишем всегда (независимо от DEBUG), чтобы это было видно в обычном логе.
    if (waitedMs > 10000) console.warn(`[долго] шлюз отдал заголовки за ${Math.round(waitedMs / 1000)} с: ${method} ${req.url}`);

    // Ошибка шлюза: читаем тело целиком, чтобы причина была в логе, клиенту уходят те же байты.
    if (upstream.status >= 400) {
      const text = upstream.body ? await upstream.text() : '';
      if (DEBUG >= 1) console.error(`[err] ${statusLine}${text ? ` тело: ${text.slice(0, 800)}` : ' (пустое тело)'}`);
      res.writeHead(upstream.status, headers);
      res.end(text);
      return;
    }
    if (DEBUG >= 2) console.log('[req] ' + statusLine);

    // 200 без SSE на stream-запросе — шлюз вернул JSON внутри успешного ответа;
    // клиент рисует это как «Internal server error», поэтому тело пишем в лог.
    const wantsStream = body.length > 0 && /"stream"\s*:\s*true/.test(body.toString('utf8'));
    // Сравнение по префиксу: шлюз отдаёт «text/event-stream; charset=utf-8», и строгое !==
    // ложно срабатывало на нормальном SSE, буферизуя стрим целиком.
    if (wantsStream && method === 'POST' && req.url.includes('/chat/completions') && !contentType.startsWith('text/event-stream')) {
      const text = upstream.body ? await upstream.text() : '';
      console.warn(`[warn] не-stream ответ (${contentType}): ${statusLine} тело: ${text.slice(0, 300)}`);
      res.writeHead(upstream.status, headers);
      res.end(text);
      return;
    }

    res.writeHead(upstream.status, headers);
    if (upstream.body) {
      const src = Readable.fromWeb(upstream.body);
      // Обрыв на стороне шлюза: клиенту передать уже нечего, но причину фиксируем в логе.
      src.on('error', (e) => {
        console.error(`[err] stream: ${method} ${req.url} (${Date.now() - started} ms): ${e}`);
        res.destroy();
      });
      src.pipe(res);
    } else {
      res.end();
    }
  } catch (e) {
    if (DEBUG >= 1) console.error(`[err] ${req.method} ${req.url} -> 502: ${e}`);
    if (res.headersSent) {
      res.destroy(); // заголовки уже ушли — 502 отправить нельзя, иначе ERR_HTTP_HEADERS_SENT
      return;
    }
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: String(e), type: 'proxy_error' } }));
  }
});

// Падение процесса и ошибки самого сервера раньше не попадали в лог: прокси молча умирал
// (или молча не стартовал из-за занятого порта), а в окне оставалось только «Proxy stopped».
process.on('uncaughtException', (e) => {
  console.error('[fatal] необработанное исключение: ' + (e?.stack || e));
  process.exit(1);
});
process.on('unhandledRejection', (e) => {
  console.error('[fatal] необработанный rejection: ' + (e?.stack || e));
  process.exit(1);
});
server.on('error', (e) => {
  console.error(`[fatal] сервер не поднялся на 127.0.0.1:${PORT}: ${e}`);
  if (e && e.code === 'EADDRINUSE')
    console.warn(info(`→ Порт занят (возможно, уже запущен второй экземпляр). Другой порт: set GW_PROXY_PORT=8788`));
  process.exit(1);
});

/* ================= Запуск ================= */

console.log('\n=== gw-proxy: проверка окружения ===');
checkNode();
checkCredentials();
checkVscodeRoo();
checkAutostart();

server.listen(PORT, '127.0.0.1', () => {
  console.log('\n=== gw-proxy: запущен ===');
  console.log(info(`Адрес для Roo / клиентов: ${BASE_URL}`));
  console.log(info(`Отладка: debug=${DEBUG} (0 — без логов, 1 — ошибки, 2 — все запросы)`));
  console.log(info(`OpenCoder: ${OPENCODER_HOME} (cli.js ${CLI_FOUND ? 'найден' : 'НЕ найден'})`));
  if (DEBUG >= 2 && process.env.NODE_DEBUG)
    console.log(info(`NODE_DEBUG=${process.env.NODE_DEBUG} — в лог пойдёт и трассировка ядра Node`));
  console.log(info(`Модели: ${PROFILES.map((p) => `${p.name} = ${p.model}`).join(' | ')}`));
  console.log(info('Останов: Ctrl+C'));
});
