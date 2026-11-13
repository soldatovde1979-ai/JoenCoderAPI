// Патчер Zoo Code: включает подпись запросов к шлюзу OpenCoder прямо внутри расширения.
// Делает ДВЕ точечные вставки в dist/extension.js и ничего больше:
//   1) в начало файла  — require внешнего модуля подписи (oc-sign.cjs) + регистрация;
//   2) в конструктор OpenAI-клиента — fetch: <подписывающая обёртка>.
// Остальные провайдеры не затрагиваются: подпись включается только для хоста шлюза.
//
// Запуск:  node patch-zoo.mjs            (патч; повторный запуск безопасен)
//          node patch-zoo.mjs --revert   (откат из .orig)
//          node patch-zoo.mjs --check    (только показать, что будет сделано)
import { readFileSync, writeFileSync, existsSync, copyFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const EXT_ROOT = path.join(os.homedir(), '.vscode', 'extensions');
const EXT_PREFIX = 'zoocodeorganization.zoo-code-';
const MARK = '/*__OC_SIGN__*/'; // маркер: по нему определяем, что файл уже пропатчен

// Точка вставки №2 — единственное место в бандле, где создаётся OpenAI-клиент
// (ветка OpenAI Compatible). Имя minified-класса (Sn, Tn, ...) меняется от версии
// к версии, поэтому оно захватывается группой и переносится в замену как $1.
const CLIENT_ANCHOR_RE =
  /this\.client=new ([A-Za-z_$][\w$]*)\(\{baseURL:r,apiKey:a,defaultHeaders:n,timeout:this\.timeoutMs\}\)/g;
const CLIENT_PATCHED =
  'this.client=new $1({baseURL:r,apiKey:a,defaultHeaders:n,timeout:this.timeoutMs,fetch:globalThis.__ocSignFetch??void 0})';

const arg = process.argv[2] || '';
const MODE = arg === '--revert' ? 'revert' : arg === '--check' ? 'check' : 'patch';

const found = existsSync(EXT_ROOT)
  ? readdirSync(EXT_ROOT)
      .filter((d) => d.startsWith(EXT_PREFIX))
      .map((d) => path.join(EXT_ROOT, d))
      .filter((d) => existsSync(path.join(d, 'dist', 'extension.js')))
  : [];

if (!found.length) {
  console.error('Zoo Code не найден: ' + path.join(EXT_ROOT, EXT_PREFIX + '*'));
  process.exit(1);
}
// Берём самую новую версию (по времени изменения бандла).
found.sort((a, b) => statSync(path.join(b, 'dist', 'extension.js')).mtimeMs - statSync(path.join(a, 'dist', 'extension.js')).mtimeMs);
const extDir = found[0];
const target = path.join(extDir, 'dist', 'extension.js');
const backup = target + '.orig';
const signModule = path.join(path.dirname(fileURLToPath(import.meta.url)), 'oc-sign.cjs');

console.log('Расширение: ' + path.basename(extDir));
console.log('Бандл:      ' + target);

/* ------------------------------- откат ------------------------------- */

if (MODE === 'revert') {
  if (!existsSync(backup)) {
    console.error('Бэкап не найден: ' + backup + ' — откатывать нечего.');
    process.exit(1);
  }
  copyFileSync(backup, target);
  console.log('[OK] Откат выполнен. Перезапустите VS Code.');
  process.exit(0);
}

/* ------------------------------- патч ------------------------------- */

const src = readFileSync(target, 'utf8');
const patched = src.includes(MARK) || src.includes('__ocSignFetch');
const anchorCount = [...src.matchAll(CLIENT_ANCHOR_RE)].length;

if (MODE === 'check') {
  console.log('Уже пропатчен: ' + patched);
  if (patched) console.log('Точек вставки клиента: 0 (якорь уже заменён патчем)');
  else if (anchorCount === 1) console.log('Точек вставки клиента: 1 (найдена)');
  else if (anchorCount === 0) console.log('Точек вставки клиента: 0 — версия Zoo изменилась');
  else console.log('Точек вставки клиента: ' + anchorCount + ' — неоднозначно, патч не применится');
  console.log('Модуль подписи на месте: ' + existsSync(signModule));
  const at = src.indexOf('"use strict";');
  console.log('Директива "use strict" в начале: ' + (at >= 0 && at < 64));
  console.log('Бэкап .orig: ' + existsSync(backup));
  process.exit(0);
}

if (patched) {
  console.log('[OK] Уже пропатчен — ничего не делаю (идемпотентно).');
  console.log('     Откат: node patch-zoo.mjs --revert');
  process.exit(0);
}

if (anchorCount !== 1) {
  if (anchorCount === 0) console.error('[!!] Точка вставки не найдена — версия Zoo изменилась.');
  else console.error('[!!] Точек вставки несколько (' + anchorCount + ') — какую патчить, не ясно.');
  console.error('     Файл НЕ изменён. Нужен новый паттерн (см. gw-proxy-setup.md).');
  process.exit(2);
}

if (!existsSync(signModule)) {
  console.error('[!!] Нет модуля подписи: ' + signModule);
  console.error('     Положите oc-sign.cjs рядом с патчером.');
  process.exit(1);
}

// 1) Бэкап — только один раз, чтобы повторный патч не затёр оригинал.
if (!existsSync(backup)) copyFileSync(target, backup);

// 2) Шапка: подключаем модуль подписи и ставим его глобально.
//    globalThis.__ocSignFetch читается в конструкторе клиента (см. вставку №2).
//    Вставляем ПОСЛЕ "use strict": код перед директивой отключает строгий режим
//    во всём бандле, а это меняет поведение minified-кода Zoo.
const header =
  MARK +
  'try{const __ocm=require(' +
  JSON.stringify(signModule) +
  ');globalThis.__ocSignFetch=__ocm.ocSignFetch||__ocm.default}' +
  'catch(__oce){console.error("[oc-sign] не загрузился:",__oce&&__oce.message||__oce)}\n';

const STRICT = '"use strict";';
const strictAt = src.indexOf(STRICT);
const insertAt = strictAt >= 0 && strictAt < 64 ? strictAt + STRICT.length : 0;
if (!insertAt) console.warn('[!] "use strict" в начале не найден — шапка вставлена первой строкой.');

let out = src.slice(0, insertAt) + '\n' + header + src.slice(insertAt);

// 3) Вставка fetch в конструктор клиента. $1 — имя minified-класса из якоря.
out = out.replace(CLIENT_ANCHOR_RE, CLIENT_PATCHED);

// 4) Проверка синтаксиса ДО записи: битый бандл сломал бы расширение.
//    Расширение .cjs обязательно: бандл — CommonJS, а .tmp node --check не разбирает.
const tmp = target + '.tmp.cjs';
try {
  writeFileSync(tmp, out, 'utf8');
  execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe', maxBuffer: 16 * 1024 * 1024 });
} catch (e) {
  try {
    unlinkSync(tmp);
  } catch {}
  console.error('[!!] Проверка синтаксиса не прошла — файл НЕ изменён.');
  console.error(String(e.stderr || e.message).slice(0, 400));
  process.exit(3);
}

// 5) Замена и уборка временного файла.
writeFileSync(target, out, 'utf8');
try {
  unlinkSync(tmp);
} catch {}

console.log('[OK] Пропатчено. Бэкап: ' + path.basename(backup));
console.log('     Перезапустите VS Code (Reload Window).');
console.log('     Откат: node patch-zoo.mjs --revert');
