const CORE_WORD_OVERRIDES = Object.freeze({
  ABRAR: "\u0623\u0628\u0631\u0627\u0631",
  ABDULLAH: "\u0639\u0628\u062f\u0627\u0644\u0644\u0647",
  ABDILLAH: "\u0639\u0628\u062f\u0627\u0644\u0644\u0647",
  AHMAD: "\u0623\u062d\u0645\u062f",
  AHMED: "\u0623\u062d\u0645\u062f",
  AISHA: "\u0639\u0627\u0626\u0634\u0629",
  AISYAH: "\u0639\u0627\u0626\u0634\u0629",
  ALI: "\u0639\u0644\u064a",
  ALLAH: "\u0627\u0644\u0644\u0647",
  ATTALLAH: "\u0639\u0637\u0627\u0644\u0644\u0647",
  ATALLAH: "\u0639\u0637\u0627\u0644\u0644\u0647",
  DZAKI: "\u0632\u0643\u064a",
  FADHIL: "\u0641\u0636\u0644",
  FADIL: "\u0641\u0627\u0636\u0644",
  FATHIMAH: "\u0641\u0627\u0637\u0645\u0629",
  FATIMAH: "\u0641\u0627\u0637\u0645\u0629",
  FARISI: "\u0641\u0627\u0631\u0633\u064a",
  HASAN: "\u062d\u0633\u0646",
  HUSAIN: "\u062d\u0633\u064a\u0646",
  HUSSEIN: "\u062d\u0633\u064a\u0646",
  IMAM: "\u0625\u0645\u0627\u0645",
  MOHAMED: "\u0645\u062d\u0645\u062f",
  MOHAMMAD: "\u0645\u062d\u0645\u062f",
  MAULANA: "\u0645\u0648\u0644\u0627\u0646\u0627",
  MUHAMMAD: "\u0645\u062d\u0645\u062f",
  NUR: "\u0646\u0648\u0631",
  RAHMAN: "\u0631\u062d\u0645\u0646",
  RAHMAT: "\u0631\u062d\u0645\u062a",
  RIDHA: "\u0631\u0636\u0627",
  RIDHO: "\u0631\u0636\u0627",
  SITI: "\u0633\u064a\u062a\u064a",
  SYAFI: "\u0634\u0627\u0641\u0639\u064a",
  SYAFII: "\u0634\u0627\u0641\u0639\u064a",
  UMAR: "\u0639\u0645\u0631",
  YUSUF: "\u064a\u0648\u0633\u0641",
  YOUSEF: "\u064a\u0648\u0633\u0641",
  ZAKI: "\u0632\u0643\u064a",
});

const BATCH_WORD_OVERRIDES = Object.freeze({
  ABDULLAH: "\u0639\u0628\u062f \u0627\u0644\u0644\u0647",
  ABDUL: "\u0639\u0628\u062f",
  ABDULAZIZ: "\u0639\u0628\u062f \u0627\u0644\u0639\u0632\u064a\u0632",
  ABDULAZIS: "\u0639\u0628\u062f \u0627\u0644\u0639\u0632\u064a\u0632",
  ABDULHAMID: "\u0639\u0628\u062f \u0627\u0644\u062d\u0645\u064a\u062f",
  ABDULKADIR: "\u0639\u0628\u062f \u0627\u0644\u0642\u0627\u062f\u0631",
  ABDULQADIR: "\u0639\u0628\u062f \u0627\u0644\u0642\u0627\u062f\u0631",
  ABDULMALIK: "\u0639\u0628\u062f \u0627\u0644\u0645\u0644\u0643",
  ABDULRAHMAN: "\u0639\u0628\u062f \u0627\u0644\u0631\u062d\u0645\u0646",
  ABDULRAHIM: "\u0639\u0628\u062f \u0627\u0644\u0631\u062d\u064a\u0645",
  ACHMAD: "\u0623\u062d\u0645\u062f",
  AHMAD: "\u0623\u062d\u0645\u062f",
  AHMADY: "\u0623\u062d\u0645\u062f\u064a",
  AHMADI: "\u0623\u062d\u0645\u062f\u064a",
  ALI: "\u0639\u0644\u064a",
  ALIF: "\u0623\u0644\u0641",
  ALIM: "\u0639\u0644\u064a\u0645",
  ALWI: "\u0639\u0644\u0648\u064a",
  ANWAR: "\u0623\u0646\u0648\u0631",
  ANWARUL: "\u0623\u0646\u0648\u0631",
  AYU: "\u0623\u064a\u0648",
  AZIZ: "\u0639\u0632\u064a\u0632",
  AZIZA: "\u0639\u0632\u064a\u0632\u0629",
  AZIZAH: "\u0639\u0632\u064a\u0632\u0629",
  BASYIR: "\u0628\u0634\u064a\u0631",
  BASIR: "\u0628\u0635\u064a\u0631",
  BASUKI: "\u0628\u0627\u0633\u0648\u0643\u064a",
  DAHLAN: "\u062f\u0647\u0644\u0627\u0646",
  DANIAL: "\u062f\u0627\u0646\u064a\u0627\u0644",
  DANI: "\u062f\u0627\u0646\u064a",
  DWI: "\u062f\u0648\u064a",
  DEWI: "\u062f\u064a\u0648\u064a",
  FAIZ: "\u0641\u0627\u0626\u0632",
  FAIZAH: "\u0641\u0627\u0626\u0632\u0629",
  FAUZAN: "\u0641\u0648\u0632\u0627\u0646",
  FAUZIA: "\u0641\u0648\u0632\u064a\u0629",
  FAUZIAH: "\u0641\u0648\u0632\u064a\u0629",
  FIKRI: "\u0641\u0643\u0631\u064a",
  FIKRIAH: "\u0641\u0643\u0631\u064a\u0629",
  FIRDAUS: "\u0641\u0631\u062f\u0648\u0633",
  GHOZALI: "\u063a\u0632\u0627\u0644\u064a",
  GHAZALI: "\u063a\u0632\u0627\u0644\u064a",
  GHANI: "\u063a\u0646\u064a",
  GHANIY: "\u063a\u0646\u064a",
  HADI: "\u0647\u0627\u062f\u064a",
  HADIYAH: "\u0647\u062f\u064a\u0629",
  HADIAH: "\u0647\u062f\u064a\u0629",
  HASAN: "\u062d\u0633\u0646",
  HASSAN: "\u062d\u0633\u0646",
  HASNA: "\u062d\u0633\u0646\u0649",
  HASNAH: "\u062d\u0633\u0646\u0649",
  HIDAYAT: "\u0647\u062f\u0627\u064a\u0629",
  HIDAYAH: "\u0647\u062f\u0627\u064a\u0629",
  IBRAHIM: "\u0625\u0628\u0631\u0627\u0647\u064a\u0645",
  IBNU: "\u0627\u0628\u0646",
  IMAM: "\u0625\u0645\u0627\u0645",
  IMRON: "\u0639\u0645\u0631\u0627\u0646",
  IMRAN: "\u0639\u0645\u0631\u0627\u0646",
  INDRA: "\u0625\u0646\u062f\u0631\u0627",
  INTAN: "\u0625\u0646\u062a\u0627\u0646",
  JABBAR: "\u062c\u0628\u0627\u0631",
  JALAL: "\u062c\u0644\u0627\u0644",
  JUNAIDI: "\u062c\u0646\u064a\u062f\u064a",
  JUNAID: "\u062c\u0646\u064a\u062f",
  KARIM: "\u0643\u0631\u064a\u0645",
  KARIMAH: "\u0643\u0631\u064a\u0645\u0629",
  KHALID: "\u062e\u0627\u0644\u062f",
  KHALIDA: "\u062e\u0627\u0644\u062f\u0629",
  LATIF: "\u0644\u0637\u064a\u0641",
  LATIFAH: "\u0644\u0637\u064a\u0641\u0629",
  LUTFI: "\u0644\u0637\u0641\u064a",
  LUTFIAH: "\u0644\u0637\u0641\u064a\u0629",
  MAARIF: "\u0645\u0639\u0627\u0631\u0641",
  MAARUF: "\u0645\u0639\u0631\u0648\u0641",
  MANSUR: "\u0645\u0646\u0635\u0648\u0631",
  MANSYUR: "\u0645\u0646\u0635\u0648\u0631",
  MARWAN: "\u0645\u0631\u0648\u0627\u0646",
  MARWAH: "\u0645\u0631\u0648\u0629",
  MUHAMMAD: "\u0645\u062d\u0645\u062f",
  MOHAMMAD: "\u0645\u062d\u0645\u062f",
  MOHAMMADY: "\u0645\u062d\u0645\u062f\u064a",
  MUHAMMADY: "\u0645\u062d\u0645\u062f\u064a",
  MUHAMMADIN: "\u0645\u062d\u0645\u062f\u064a\u0646",
  MUHSIN: "\u0645\u062d\u0633\u0646",
  MUHSINA: "\u0645\u062d\u0633\u0646\u0629",
  MUKHLIS: "\u0645\u062e\u0644\u0635",
  MUKHLISIN: "\u0645\u062e\u0644\u0635\u064a\u0646",
  MUSTAFA: "\u0645\u0635\u0637\u0641\u0649",
  MUSTOFA: "\u0645\u0635\u0637\u0641\u0649",
  NAIM: "\u0646\u0639\u064a\u0645",
  NAIMA: "\u0646\u0639\u064a\u0645\u0629",
  NASIR: "\u0646\u0627\u0635\u0631",
  NASRUL: "\u0646\u0635\u0631",
  NASRULLAH: "\u0646\u0635\u0631 \u0627\u0644\u0644\u0647",
  NUR: "\u0646\u0648\u0631",
  NURUL: "\u0646\u0648\u0631",
  NURDIN: "\u0646\u0648\u0631 \u0627\u0644\u062f\u064a\u0646",
  NURHIDAYAH: "\u0646\u0648\u0631 \u0647\u062f\u0627\u064a\u0629",
  NURUDDIN: "\u0646\u0648\u0631 \u0627\u0644\u062f\u064a\u0646",
  PUTRA: "\u0628\u0648\u062a\u0631\u0627",
  PUTRI: "\u0628\u0648\u062a\u0631\u064a",
  RAHMAN: "\u0631\u062d\u0645\u0646",
  RAHIM: "\u0631\u062d\u064a\u0645",
  RAHMANI: "\u0631\u062d\u0645\u0627\u0646\u064a",
  RAMADAN: "\u0631\u0645\u0636\u0627\u0646",
  RAMADHANI: "\u0631\u0645\u0636\u0627\u0646\u064a",
  RAMADANI: "\u0631\u0645\u0636\u0627\u0646\u064a",
  RIDWAN: "\u0631\u0636\u0648\u0627\u0646",
  RIDHO: "\u0631\u0636\u0627",
  RIDHA: "\u0631\u0636\u0627",
  SAID: "\u0633\u0639\u064a\u062f",
  SAIFUL: "\u0633\u064a\u0641",
  SAIFULLAH: "\u0633\u064a\u0641 \u0627\u0644\u0644\u0647",
  SALAHUDDIN: "\u0635\u0644\u0627\u062d \u0627\u0644\u062f\u064a\u0646",
  SALAHUDIN: "\u0635\u0644\u0627\u062d \u0627\u0644\u062f\u064a\u0646",
  SATRIA: "\u0633\u0627\u062a\u0631\u064a\u0627",
  SATRIO: "\u0633\u0627\u062a\u0631\u064a\u0648",
  SHAFIQ: "\u0634\u0641\u064a\u0642",
  SHAFI: "\u0634\u0627\u0641\u064a",
  SYAFIQ: "\u0634\u0641\u064a\u0642",
  SYAFI: "\u0634\u0627\u0641\u064a",
  SYAHRUL: "\u0634\u0647\u0631",
  SYAHRULLOH: "\u0634\u0647\u0631 \u0627\u0644\u0644\u0647",
  SYAMSUL: "\u0634\u0645\u0633",
  SYAMSUDDIN: "\u0634\u0645\u0633 \u0627\u0644\u062f\u064a\u0646",
  TAHIR: "\u0637\u0627\u0647\u0631",
  TAHIRAH: "\u0637\u0627\u0647\u0631\u0629",
  UMAR: "\u0639\u0645\u0631",
  UMAROH: "\u0639\u0645\u0631\u0629",
  USMAN: "\u0639\u062b\u0645\u0627\u0646",
  UTHMAN: "\u0639\u062b\u0645\u0627\u0646",
  WAHID: "\u0648\u0627\u062d\u062f",
  WAHIDAH: "\u0648\u0627\u062d\u062f\u0629",
  YULI: "\u064a\u0648\u0644\u064a",
  YULIANA: "\u064a\u0648\u0644\u064a\u0627\u0646\u0627",
  YUSUF: "\u064a\u0648\u0633\u0641",
  YUSUFY: "\u064a\u0648\u0633\u0641\u064a",
  YUSUFI: "\u064a\u0648\u0633\u0641\u064a",
  ZAIN: "\u0632\u064a\u0646",
  ZAINAL: "\u0632\u064a\u0646 \u0627\u0644\u0639\u0627\u0628\u062f\u064a\u0646",
  ZAINUDDIN: "\u0632\u064a\u0646 \u0627\u0644\u062f\u064a\u0646",
  ZAKARIA: "\u0632\u0643\u0631\u064a\u0627",
  ZULKARNAIN: "\u0630\u0648 \u0627\u0644\u0642\u0631\u0646\u064a\u0646",
  ZULFIKAR: "\u0630\u0648 \u0627\u0644\u0641\u0642\u0627\u0631",
});

const WORD_OVERRIDES = Object.freeze({
  ...CORE_WORD_OVERRIDES,
  ...BATCH_WORD_OVERRIDES,
});

const MULTI_CHAR_RULES = Object.freeze({
  aa: "\u0627",
  ee: "\u064a",
  ii: "\u064a",
  sy: "\u0634",
  sh: "\u0634",
  kh: "\u062e",
  dz: "\u0632",
  gh: "\u063a",
  th: "\u062b",
  dh: "\u0636",
  ng: "\u0646\u063a",
  ny: "\u0646\u064a",
  oo: "\u0648",
  ou: "\u0648",
  uu: "\u0648",
});

const TOKEN_OVERRIDES = Object.freeze({
  AL: "\u0627\u0644",
  BIN: "\u0628\u0646",
  BINT: "\u0628\u0646\u062a",
  BINTI: "\u0628\u0646\u062a",
  BT: "\u0628\u0646\u062a",
  BTE: "\u0628\u0646\u062a",
  EL: "\u0627\u0644",
  IBN: "\u0628\u0646",
});

const VOWELS = new Set(["a", "e", "i", "o", "u"]);

const BASIC_CHAR_MAP = Object.freeze({
  b: "\u0628",
  c: "\u0643",
  d: "\u062f",
  f: "\u0641",
  g: "\u062c",
  h: "\u0647",
  j: "\u062c",
  k: "\u0643",
  l: "\u0644",
  m: "\u0645",
  n: "\u0646",
  p: "\u0628",
  q: "\u0642",
  r: "\u0631",
  s: "\u0633",
  t: "\u062a",
  v: "\u0641",
  w: "\u0648",
  x: "\u0643\u0633",
  y: "\u064a",
  z: "\u0632",
});

function hasOwn(node, key) {
  return Object.prototype.hasOwnProperty.call(node, key);
}

export function transliterateName(name) {
  const normalized = normalizeName(name);
  if (!normalized) {
    return "";
  }

  const tokens = normalized.split(" ");
  const words = [];
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    const uppercaseToken = token.toUpperCase();

    if ((uppercaseToken === "ABDUL" || uppercaseToken === "ABD") && tokens[index + 1]?.toUpperCase() === "ALLAH") {
      words.push("\u0639\u0628\u062f");
      words.push(WORD_OVERRIDES.ALLAH);
      index += 2;
      continue;
    }

    if (hasOwn(TOKEN_OVERRIDES, uppercaseToken)) {
      words.push(TOKEN_OVERRIDES[uppercaseToken]);
      index += 1;
      continue;
    }

    words.push(transliterateWord(token));
    index += 1;
  }

  return words.filter(Boolean).join(" ");
}

export function transliterateWord(word) {
  const normalizedWord = String(word ?? "");
  const uppercaseWord = normalizedWord.toUpperCase();
  const overrideKey = uppercaseWord.replaceAll("'", "");
  if (hasOwn(WORD_OVERRIDES, overrideKey)) {
    return WORD_OVERRIDES[overrideKey];
  }

  if (uppercaseWord.endsWith("ALLAH") && uppercaseWord.length > 5) {
    const prefix = uppercaseWord.slice(0, -5);
    const prefixText = transliterateWord(prefix.toLowerCase());
    return prefixText ? `${prefixText}${WORD_OVERRIDES.ALLAH}` : WORD_OVERRIDES.ALLAH;
  }

  const letters = [];
  let index = 0;
  while (index < normalizedWord.length) {
    const pattern = normalizedWord.slice(index, index + 2);
    if (hasOwn(MULTI_CHAR_RULES, pattern)) {
      letters.push(MULTI_CHAR_RULES[pattern]);
      index += 2;
      continue;
    }

    const character = normalizedWord[index];
    if (VOWELS.has(character)) {
      const mappedVowel = mapVowel(normalizedWord, index, character);
      if (mappedVowel) {
        letters.push(mappedVowel);
      }
      index += 1;
      continue;
    }
    if (character === "'") {
      letters.push(apostropheMarker(normalizedWord, index));
      index += 1;
      continue;
    }
    if (hasOwn(BASIC_CHAR_MAP, character)) {
      letters.push(BASIC_CHAR_MAP[character]);
    }
    index += 1;
  }

  return letters.join("");
}

function normalizeName(name) {
  const cleaned = String(name ?? "")
    .replace(/[^a-zA-Z\s\-']/g, " ")
    .replace(/-/g, " ");
  return cleaned.replace(/\s+/g, " ").trim().toLowerCase();
}

function mapVowel(word, index, character) {
  if (index === 0) {
    return character === "a" || character === "e" || character === "i" ? "\u0627" : "\u0648";
  }

  if (index === word.length - 1) {
    if (character === "a") {
      return "\u0627";
    }
    if (character === "e" || character === "i") {
      return "\u064a";
    }
    return "\u0648";
  }

  if (word.length <= 4) {
    if (character === "a") {
      return "\u0627";
    }
    if (character === "e" || character === "i") {
      return "\u064a";
    }
    return "\u0648";
  }

  if (character === "a") {
    return "";
  }
  if (character === "e" || character === "i") {
    return "\u064a";
  }
  return "\u0648";
}

function apostropheMarker(word, index) {
  const previousChar = index > 0 ? word[index - 1] : "";
  const nextChar = index + 1 < word.length ? word[index + 1] : "";

  if (VOWELS.has(previousChar) && VOWELS.has(nextChar)) {
    return "\u0621";
  }
  if (!previousChar && VOWELS.has(nextChar)) {
    return "\u0639";
  }
  if (VOWELS.has(nextChar)) {
    return "\u0639";
  }
  return "\u0621";
}
