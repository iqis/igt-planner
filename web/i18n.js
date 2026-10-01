// The interface, in six languages. t("key", {vars}) looks the key up in the current language, falls
// back to English, and fills {placeholders}. Fixed text in index.html carries data-i18n (text, which
// may hold a little markup), data-i18n-title, -placeholder and -aria, and applyStatic() fills it.
//
// What is NOT translated, on purpose:
//   - part names: there are official names only in English (US store) and Japanese (JP store). The
//     Japanese interface shows the Japanese name; every other language shows the English one, and the
//     part card always carries the SKU, which finds the part in any region's store. A machine-made
//     Korean or Chinese product name is a name no shop will recognise.
//   - the rules engine's messages to agents (core.js evaluate): English, so an agent always reads the
//     same thing.
import en from "./i18n/en.js";
import zhHans from "./i18n/zh-Hans.js";
import zhHant from "./i18n/zh-Hant.js";
import ja from "./i18n/ja.js";
import ko from "./i18n/ko.js";
import th from "./i18n/th.js";

export const LANGS = [
  ["en", "English"], ["zh-Hans", "简体中文"], ["zh-Hant", "繁體中文"],
  ["ja", "日本語"], ["ko", "한국어"], ["th", "ไทย"],
];
export const DICTS = { en, "zh-Hans": zhHans, "zh-Hant": zhHant, ja, ko, th };
const LS_LANG = "igt.lang";

/** The browser's languages, mapped onto ours: zh-TW / HK / MO / Hant -> Traditional, other zh -> Simplified. */
function detect() {
  try { const saved = localStorage.getItem(LS_LANG); if (DICTS[saved]) return saved; } catch {}
  for (const raw of navigator.languages || [navigator.language || "en"]) {
    const l = raw.toLowerCase();
    if (l.startsWith("zh")) return /(tw|hk|mo|hant)/.test(l) ? "zh-Hant" : "zh-Hans";
    for (const code of ["ja", "ko", "th", "en"]) if (l === code || l.startsWith(code + "-")) return code;
  }
  return "en";
}
let lang = detect();
document.documentElement.lang = lang;

export const getLang = () => lang;
export function t(key, vars) {
  let s = DICTS[lang]?.[key] ?? en[key];
  if (s == null) return key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
  return s;
}
/** Choose a language. The page reloads into it: every painted string is rebuilt from scratch, which is
 *  simpler and surer than re-rendering in place -- and the design is in localStorage, so nothing is lost. */
export function setLang(code) {
  if (!DICTS[code] || code === lang) return;
  try { localStorage.setItem(LS_LANG, code); } catch {}
  location.reload();
}
export function applyStatic(root = document) {
  for (const el of root.querySelectorAll("[data-i18n]")) el.innerHTML = t(el.dataset.i18n);
  for (const el of root.querySelectorAll("[data-i18n-title]")) el.title = t(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll("[data-i18n-placeholder]")) el.placeholder = t(el.dataset.i18nPlaceholder);
  for (const el of root.querySelectorAll("[data-i18n-aria]")) el.setAttribute("aria-label", t(el.dataset.i18nAria));
}
