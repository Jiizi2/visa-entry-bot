import assert from "node:assert/strict";
import test from "node:test";

import {
  applyEntryDefaultsToManifest,
  createEntryDefaults,
  entryDefaultsActiveCount,
  loadEntryDefaults,
  saveEntryDefaults,
  updateEntryDefaultValue,
} from "../src/main-entry-defaults.js";

function memoryStorage(initial = {}) {
  const entries = new Map(Object.entries(initial));
  return {
    entries,
    getItem(key) {
      return entries.has(key) ? entries.get(key) : null;
    },
    setItem(key, value) {
      entries.set(key, String(value));
    },
  };
}

test("entry defaults normalize values and persist to storage", () => {
  const storage = memoryStorage();
  const defaults = updateEntryDefaultValue(createEntryDefaults(), "profession", " OTHER ");
  const next = updateEntryDefaultValue(defaults, "mobileNumber", " +628123456789 ");

  saveEntryDefaults(next, "defaults", storage);
  const loaded = loadEntryDefaults("defaults", storage);

  assert.equal(loaded.profession, "OTHER");
  assert.equal(loaded.mobileNumber, "+628123456789");
  assert.equal(entryDefaultsActiveCount(loaded), 2);
});

test("entry defaults ignore invalid storage payloads", () => {
  const storage = memoryStorage({ defaults: "not-json" });

  assert.deepEqual(loadEntryDefaults("defaults", storage), createEntryDefaults());
});

test("applyEntryDefaultsToManifest fills empty fields without overwriting reviewed data", () => {
  const manifest = {
    members: [
      {
        id: "adult",
        resolvedProfile: {
          firstName: "Adult",
          profession: "TEACHER",
          email: "",
        },
      },
      {
        id: "child",
        resolvedProfile: {
          firstName: "Child",
          dob: "2020/01/01",
        },
      },
    ],
  };

  const result = applyEntryDefaultsToManifest(manifest, {
    profession: "OTHER",
    email: "group@example.com",
    mobileNumber: "+628123456789",
  });

  assert.equal(result.appliedCount, 5);
  assert.equal(result.touchedMemberCount, 2);
  assert.equal(manifest.members[0].resolvedProfile.profession, "TEACHER");
  assert.equal(manifest.members[0].resolvedProfile.email, "group@example.com");
  assert.equal(manifest.members[0].resolvedProfile.mobileNumber, "+628123456789");
  assert.equal(manifest.members[1].resolvedProfile.profession, "OTHER");
  assert.equal(manifest.members[1].resolvedProfile.email, "group@example.com");
  assert.equal(manifest.members[1].resolvedProfile.mobileNumber, "+628123456789");
});
