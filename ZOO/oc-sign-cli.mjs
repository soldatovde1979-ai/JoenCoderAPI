// CLI-подписант для 1С 8.2: считает заголовки ed25519-v1 и отдаёт их плоским текстом.
// Криптография не дублируется — используется signedHeaders() из oc-sign.cjs (через oc-sign.mjs).
//
// Запуск: node oc-sign-cli.mjs <in.txt> <out.txt>
//
// in.txt (UTF-8, строки через \n, поля через табуляцию):
//   method<TAB>POST
//   url<TAB>https://code.accelstacks.com/gw/v1/chat/completions
//   bodyfile<TAB>C:\Temp\oc_xxx.body          (нет строки — пустое тело)
//   cred<TAB>C:\Users\...\cc-web-credentials.json   (необязательно; по умолчанию %LOCALAPPDATA%)
//
// out.txt (UTF-8, без BOM), построчно:
//   header<TAB><имя><TAB><значение>
//   ...
//   bodyfile<TAB><путь к файлу тела, байты которого подписаны>
// либо при ошибке:
//   error<TAB><текст>
//
// Зачем bodyfile в ответе: 1С (ЗаписьТекста) пишет UTF-8 с BOM, а BOM в начале
// JSON ломает разбор на шлюзе. Здесь BOM срезается, нормализованное тело
// сохраняется рядом с out.txt, и подпись считается ровно по этим байтам.
// 1С отправляет в HTTP именно этот файл — тело и подпись совпадают всегда.
//
// Код возврата: 0 — подпись посчитана, 1 — ошибка (причина в out.txt и stderr).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { signedHeaders } from './oc-sign.mjs';

const GW_KEY = 'https://code.accelstacks.com/gw';
const DEFAULT_CRED = path.join(process.env.LOCALAPPDATA || '', 'OpenCoder', 'cc-web-credentials.json');
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

// Значение заголовка не должно ломать построчный формат out.txt.
const oneLine = (s) => String(s == null ? '' : s).replace(/[\t\r\n]+/g, ' ');

function parseInput(text) {
  const out = {};
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!line) continue;
    const i = line.indexOf('\t');
    if (i < 0) continue;
    out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1);
  }
  return out;
}

// Чтение файла креденшалов — не криптография: ключ и подпись считает signedHeaders().
function readCred(file) {
  const p = file || DEFAULT_CRED;
  const j = JSON.parse(readFileSync(p, 'utf8'));
  const c = j && j.credentials && j.credentials[GW_KEY];
  if (!c || !c.requestSigningPrivateKey) {
    throw new Error('нет ключа подписи в ' + p + ' (войдите в OpenCoder или укажите cred= в in.txt)');
  }
  return c;
}

function main() {
  const [inPath, outPath] = process.argv.slice(2);
  if (!inPath || !outPath) throw new Error('использование: node oc-sign-cli.mjs <in.txt> <out.txt>');

  const req = parseInput(readFileSync(inPath, 'utf8'));
  if (!req.url) throw new Error('в in.txt нет поля url');
  if (req.cred && /[\t\r\n]/.test(req.cred)) throw new Error('путь cred содержит табуляцию или перевод строки');

  const method = (req.method || 'POST').toUpperCase();
  const raw = req.bodyfile ? readFileSync(req.bodyfile) : Buffer.alloc(0);
  const body = raw.length >= 3 && raw.subarray(0, 3).equals(BOM) ? raw.subarray(3) : raw;

  const bodyPath = outPath + '.body';
  writeFileSync(bodyPath, body);
  const headers = signedHeaders(readCred(req.cred), req.url, method, body);

  const lines = Object.entries(headers).map(([k, v]) => 'header\t' + k + '\t' + oneLine(v));
  lines.push('bodyfile\t' + bodyPath);
  writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');
}

try {
  main();
} catch (e) {
  const outPath = process.argv[3];
  const text = 'error\t' + oneLine(e && e.message ? e.message : e) + '\n';
  if (outPath) {
    try {
      writeFileSync(outPath, text, 'utf8');
    } catch {} // out.txt недоступен для записи — причина всё равно уйдёт в stderr
  }
  process.stderr.write(text);
  process.exit(1);
}
