import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  assertLocaleParity,
  buildLocaleParityReport,
  localeParityErrors,
} from "./locale-catalog-validation.mjs";

const temporary = await mkdtemp(path.join(tmpdir(), "start-tab-round50-"));

async function writeCatalog(root, locale, file, value) {
  const target = path.join(root, locale, file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeRawCatalog(root, locale, file, source) {
  const target = path.join(root, locale, file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, source, "utf8");
}

async function scenario(name, setup) {
  const root = path.join(temporary, name);
  await setup(root);
  return buildLocaleParityReport(root, "en", "ru");
}

function messages(entries) {
  return Object.fromEntries(Object.entries(entries).map(([key, message]) => [key, { message }]));
}

try {
  const clean = await scenario("clean", async (root) => {
    await writeCatalog(root, "en", "messages.json", messages({
      greeting: "Hello {name}",
      remaining: "{remaining} left on {host}",
    }));
    await writeCatalog(root, "en", "round7-messages.json", messages({ advanced: "Advanced" }));
    await writeCatalog(root, "ru", "messages.json", messages({ greeting: "Привет, {name}" }));
    await writeCatalog(root, "ru", "roadmap-messages.json", messages({ remaining: "Для {host} осталось {remaining}" }));
    await writeCatalog(root, "ru", "round7-messages.json", messages({ advanced: "Расширенный" }));
  });
  assert.deepEqual(localeParityErrors(clean), [], "Clean split locale catalogs must pass");
  assert.doesNotThrow(() => assertLocaleParity(clean));

  const missing = await scenario("missing", async (root) => {
    await writeCatalog(root, "en", "messages.json", messages({ one: "One", two: "Two" }));
    await writeCatalog(root, "ru", "messages.json", messages({ one: "Один" }));
  });
  assert.deepEqual(missing.missingTargetKeys, ["two"]);
  assert.throws(() => assertLocaleParity(missing), /Missing ru locale keys: two/,
    "Missing Russian key must fail locale validation");

  const extra = await scenario("extra", async (root) => {
    await writeCatalog(root, "en", "messages.json", messages({ one: "One" }));
    await writeCatalog(root, "ru", "messages.json", messages({ one: "Один", two: "Два" }));
  });
  assert.deepEqual(extra.extraTargetKeys, ["two"]);
  assert.throws(() => assertLocaleParity(extra), /Extra ru locale keys: two/,
    "Extra Russian key must fail locale validation");

  const duplicate = await scenario("duplicate", async (root) => {
    await writeCatalog(root, "en", "messages.json", messages({ one: "One" }));
    await writeCatalog(root, "en", "round7-messages.json", messages({ one: "Duplicate" }));
    await writeCatalog(root, "ru", "messages.json", messages({ one: "Один" }));
  });
  assert.deepEqual(duplicate.duplicateSourceKeys, ["one"]);
  assert.throws(() => assertLocaleParity(duplicate), /Duplicate en locale keys: one/,
    "Duplicate key across locale fragments must fail locale validation");

  const duplicateInFile = await scenario("duplicate-in-file", async (root) => {
    await writeRawCatalog(root, "en", "messages.json",
      '{"one":{"message":"First"},"one":{"message":"Second"}}\n');
    await writeCatalog(root, "ru", "messages.json", messages({ one: "Один" }));
  });
  assert.deepEqual(duplicateInFile.duplicateSourceKeys, ["one"]);
  assert.throws(() => assertLocaleParity(duplicateInFile), /Duplicate en locale keys: one/,
    "Duplicate key inside one locale JSON file must fail before JSON.parse can hide it");

  const malformed = await scenario("malformed", async (root) => {
    await writeCatalog(root, "en", "messages.json", {
      brokenType: { message: 123 },
      empty: { message: "   " },
    });
    await writeCatalog(root, "ru", "messages.json", {
      brokenType: { message: "Нормально" },
      empty: { message: "Непусто" },
    });
  });
  assert.ok(malformed.schemaErrors.some((error) => /brokenType: message must be a string/.test(error)));
  assert.ok(malformed.schemaErrors.some((error) => /empty: message must not be empty/.test(error)));
  assert.throws(() => assertLocaleParity(malformed), /Locale schema error/,
    "Malformed or empty locale messages must fail before runtime translation");

  const placeholders = await scenario("placeholders", async (root) => {
    await writeCatalog(root, "en", "messages.json", messages({
      status: "{remaining} left on {host}",
    }));
    await writeCatalog(root, "ru", "messages.json", messages({
      status: "Для {hostname} осталось {remaining}",
    }));
  });
  assert.deepEqual(placeholders.placeholderMismatches, [{
    key: "status",
    sourcePlaceholders: ["host", "remaining"],
    targetPlaceholders: ["hostname", "remaining"],
  }]);
  assert.throws(() => assertLocaleParity(placeholders), /Locale placeholder mismatch for status/,
    "Translated runtime templates must preserve the source placeholder set");

  console.log("Round 50 locale fixtures passed");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
