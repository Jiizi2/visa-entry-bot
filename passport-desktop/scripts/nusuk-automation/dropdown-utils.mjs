import { normalizeOption } from "./core-utils.mjs";

function buildOptionAliases(normalizedValue, optionKind) {
  const aliases = new Set([normalizedValue]);
  if (optionKind !== "passport_type") {
    return Array.from(aliases);
  }

  const map = {
    normal: ["normal"],
    diplomatic: ["diplomatic"],
    other: ["other"],
    traveldocuments: ["travel documents", "travel document", "traveldocuments"],
    unpassport: ["un passport", "unpassport"],
    privatepassport: ["private passport", "privatepassport"],
  };

  const compact = normalizedValue.replace(/\s+/g, "");
  for (const alias of map[compact] ?? []) {
    aliases.add(normalizeOption(alias));
  }
  return Array.from(aliases);
}

export async function findPrimeNgDropdownOption(page, optionText, optionKind, timeoutMs = 8000) {
  const itemsSelector = ".p-dropdown-panel .p-dropdown-items .p-dropdown-item, .p-dropdown-panel [role='option']";
  const panelSelector = ".p-dropdown-panel";
  const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || 8000);
  let items = page.locator(itemsSelector);
  let count = await items.count();

  while (count === 0 && Date.now() < deadline) {
    await page.locator(panelSelector).first().waitFor({ timeout: 1200, state: "visible" }).catch(() => {});
    await page.waitForTimeout(200);
    items = page.locator(itemsSelector);
    count = await items.count();
  }
  if (!count) {
    return null;
  }

  const expected = normalizeOption(optionText);
  const aliases = buildOptionAliases(expected, optionKind);
  let partialMatchIndex = -1;
  const availableLabels = [];

  for (let index = 0; index < count; index += 1) {
    const labelRaw = await items.nth(index).innerText();
    const label = normalizeOption(labelRaw);
    availableLabels.push(String(labelRaw ?? "").trim());

    if (aliases.includes(label)) {
      return items.nth(index);
    }

    if (partialMatchIndex < 0 && aliases.some((candidate) => label.includes(candidate) || candidate.includes(label))) {
      partialMatchIndex = index;
    }
  }

  if (partialMatchIndex >= 0) {
    return items.nth(partialMatchIndex);
  }

  throw new Error(`Opsi dropdown "${optionText}" tidak ditemukan. Opsi tersedia: ${availableLabels.join(", ")}`);
}

export async function trySelectNativeByText(page, selector, optionText, optionKind, nth) {
  const locator = nth === null ? page.locator(selector) : page.locator(selector).nth(nth);
  const count = nth === null ? await locator.count() : 1;
  if (!count) {
    return false;
  }

  for (let i = 0; i < count; i += 1) {
    const candidate = nth === null ? locator.nth(i) : locator;
    const tagName = String(await candidate.evaluate((el) => el?.tagName || "").catch(() => "")).toLowerCase();
    if (tagName !== "select") {
      continue;
    }

    const selected = await candidate.evaluate((element, payload) => {
      const { rawText, kind } = payload ?? {};
      const select = element;
      if (!select || !select.options) {
        return false;
      }

      const normalize = (value) =>
        String(value ?? "")
          .normalize("NFKD")
          .replace(/[\u0300-\u036f]/g, "")
          .trim()
          .toLowerCase()
          .replace(/[().,-]/g, " ")
          .replace(/\s+/g, " ");

      const target = normalize(rawText);
      const compact = target.replace(/\s+/g, "");
      const aliases = new Set([target, compact]);
      if (kind === "birth_country") {
        const countryAliasMap = {
          indonesia: ["indonesia", "republic of indonesia"],
          "china prc": ["china prc", "china (prc)", "prc", "china"],
          "korea south": ["south korea", "korea south", "republic of korea", "korea, republic of"],
          "ivory coast": ["ivory coast", "cote d ivoire", "cote divoire"],
          "congo dem rep of former zaire": [
            "congo dem rep of former zaire",
            "democratic republic of congo",
            "dr congo",
            "congo kinshasa",
          ],
        };

        const hit = countryAliasMap[compact];
        if (Array.isArray(hit)) {
          for (const item of hit) {
            const n = normalize(item);
            aliases.add(n);
            aliases.add(n.replace(/\s+/g, ""));
          }
        }
      }
      if (kind === "marital_status") {
        const statusAliasMap = {
          single: ["single", "unmarried", "belum menikah", "lajang"],
          married: ["married", "menikah", "kawin"],
          divorced: ["divorced", "cerai", "cerai hidup", "divorce"],
          widowed: ["widowed", "janda", "duda", "ditinggal mati pasangan"],
          other: ["other", "lainnya", "lain lain"],
        };

        const hit = statusAliasMap[compact];
        if (Array.isArray(hit)) {
          for (const item of hit) {
            const n = normalize(item);
            aliases.add(n);
            aliases.add(n.replace(/\s+/g, ""));
          }
        }
      }

      let picked = "";
      for (const option of Array.from(select.options)) {
        const label = normalize(option.textContent);
        const value = normalize(option.value);
        const compactLabel = label.replace(/\s+/g, "");
        const compactValue = value.replace(/\s+/g, "");

        if (
          aliases.has(label)
          || aliases.has(value)
          || aliases.has(compactLabel)
          || aliases.has(compactValue)
          || Array.from(aliases).some((candidateAlias) => label.includes(candidateAlias) || value.includes(candidateAlias))
        ) {
          picked = option.value;
          break;
        }
      }

      if (!picked) {
        return false;
      }

      select.value = picked;
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }, { rawText: optionText, kind: optionKind });

    if (selected) {
      return true;
    }
  }

  return false;
}

