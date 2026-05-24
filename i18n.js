import ptBR   from "./i18n/pt-BR.js";
import en     from "./i18n/en.js";
import es     from "./i18n/es.js";
import fr     from "./i18n/fr.js";
import de     from "./i18n/de.js";
import it     from "./i18n/it.js";
import nl     from "./i18n/nl.js";
import ar     from "./i18n/ar.js";
import hi     from "./i18n/hi.js";
import trLang from "./i18n/tr.js";
import idLang from "./i18n/id.js";
import vi     from "./i18n/vi.js";
import ja     from "./i18n/ja.js";
import ko     from "./i18n/ko.js";
import zh     from "./i18n/zh.js";
import ru     from "./i18n/ru.js";
import pl     from "./i18n/pl.js";

export const LANGUAGES = [
  { code: "pt-BR", label: "Português (BR)" },
  { code: "en",    label: "English" },
  { code: "es",    label: "Español" },
  { code: "fr",    label: "Français" },
  { code: "de",    label: "Deutsch" },
  { code: "it",    label: "Italiano" },
  { code: "nl",    label: "Nederlands" },
  { code: "ar",    label: "العربية" },
  { code: "hi",    label: "हिन्दी" },
  { code: "tr",    label: "Türkçe" },
  { code: "id",    label: "Bahasa Indonesia" },
  { code: "vi",    label: "Tiếng Việt" },
  { code: "ja",    label: "日本語" },
  { code: "ko",    label: "한국어" },
  { code: "zh",    label: "中文" },
  { code: "ru",    label: "Русский" },
  { code: "pl",    label: "Polski" }
];

const STRINGS = {
  "pt-BR": ptBR,
  en, es, fr, de, it, nl, ar, hi,
  tr: trLang,
  id: idLang,
  vi, ja, ko, zh, ru, pl
};

export const RTL_LANGS = new Set(["ar"]);

export function detectLanguage() {
  const nav = navigator.language || "en";
  if (nav.startsWith("pt"))    return "pt-BR";
  if (nav.startsWith("es"))    return "es";
  if (nav.startsWith("fr"))    return "fr";
  if (nav.startsWith("de"))    return "de";
  if (nav.startsWith("it"))    return "it";
  if (nav.startsWith("nl"))    return "nl";
  if (nav.startsWith("ar"))    return "ar";
  if (nav.startsWith("hi"))    return "hi";
  if (nav.startsWith("tr"))    return "tr";
  if (nav.startsWith("id"))    return "id";
  if (nav.startsWith("vi"))    return "vi";
  if (nav.startsWith("ja"))    return "ja";
  if (nav.startsWith("ko"))    return "ko";
  if (nav.startsWith("zh"))    return "zh";
  if (nav.startsWith("ru"))    return "ru";
  if (nav.startsWith("pl"))    return "pl";
  return "en";
}

let _lang = "en";

export function setLanguage(code) {
  _lang = STRINGS[code] ? code : "en";
}

export function t() {
  return STRINGS[_lang] || STRINGS["en"];
}

export function tr(key, vars = {}) {
  const parts = key.split(".");
  let val = STRINGS[_lang];
  for (const p of parts) val = val?.[p];
  if (!val) {
    val = STRINGS["en"];
    for (const p of parts) val = val?.[p];
  }
  if (typeof val !== "string") return key;
  return val.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}
