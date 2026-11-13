// Тонкая ESM-обёртка над oc-sign.cjs.
// Реализация живёт в CJS, потому что именно её грузит через require() пропатченный
// бандл Zoo (dist/extension.js — CommonJS). Здесь дублирования логики нет.
//
// Использование:
//   import { ocSignFetch } from './oc-sign.mjs';
//   new OpenAI({ apiKey, baseURL, fetch: ocSignFetch })
import mod from './oc-sign.cjs';

export const ocSignFetch = mod.ocSignFetch;
export const signedHeaders = mod.signedHeaders;
export default ocSignFetch;
