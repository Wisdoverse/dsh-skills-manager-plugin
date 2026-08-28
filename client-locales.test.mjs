import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const clientSource = (await readFile(new URL("./client/client.js", import.meta.url), "utf8"))
  .replace(/\r\n/g, "\n");
const dictionaryStartMarker = "    const DICT = ";
const dictionaryEndMarker = "\n\n    const styles =";
const dictionaryStart = clientSource.indexOf(dictionaryStartMarker);
const dictionaryEnd = clientSource.indexOf(dictionaryEndMarker, dictionaryStart);

assert.notEqual(dictionaryStart, -1, "client dictionary start must exist");
assert.notEqual(dictionaryEnd, -1, "client dictionary end must exist");

const dictionarySource = clientSource
  .slice(dictionaryStart + dictionaryStartMarker.length, dictionaryEnd)
  .trim()
  .replace(/;$/, "");
const dictionary = Function(`"use strict"; return (${dictionarySource});`)();

function loadClientPlugin() {
  let definition;
  vm.runInNewContext(clientSource, {
    window: {
      __ModuleLoader__: {
        load(value) {
          definition = value;
        },
      },
    },
  });
  assert.ok(definition, "client module loader definition must be registered");
  return definition.factory((name) => {
    assert.equal(name, "react");
    return {
      createElement() {},
      useCallback: (callback) => callback,
      useEffect() {},
      useRef: (value) => ({ current: value }),
      useState: (value) => [value, () => {}],
    };
  });
}

test("Settings dictionaries provide matching English and Chinese keys", () => {
  assert.deepEqual(Object.keys(dictionary).sort(), ["en", "zh"]);
  assert.deepEqual(Object.keys(dictionary.en).sort(), Object.keys(dictionary.zh).sort());
  for (const locale of ["en", "zh"]) {
    for (const [key, value] of Object.entries(dictionary[locale])) {
      assert.equal(typeof value, "string", `${locale}.${key} must be a string`);
      assert.ok(value.trim(), `${locale}.${key} must not be empty`);
    }
  }
});

test("Settings copy is resolved through the locale seat", () => {
  const sourceWithoutDictionary = clientSource.slice(0, dictionaryStart)
    + clientSource.slice(dictionaryEnd);
  assert.doesNotMatch(sourceWithoutDictionary, /[\u3400-\u9fff]/u);
  assert.match(clientSource, /function ManagerSection\(\{ connection, t \}\)/);
  assert.match(clientSource, /locale: "skillManager"/);

  const directKeys = [...clientSource.matchAll(/\bt\("([^"]+)"\)/g)].map((match) => match[1]);
  for (const key of directKeys) {
    assert.ok(Object.hasOwn(dictionary.en, key), `missing English key: ${key}`);
    assert.ok(Object.hasOwn(dictionary.zh, key), `missing Chinese key: ${key}`);
  }
});

test("Settings navigation follows the active DSH locale", () => {
  const plugin = loadClientPlugin();
  const connection = {};
  let activeLocale = "zh";
  let registeredDictionary;
  let settingsEntry;
  const locale = {
    bind: () => (key) => registeredDictionary[activeLocale][key],
    register: (_namespace, value) => {
      registeredDictionary = value;
      return () => {};
    },
  };
  const slots = {
    inject: (name, register) => {
      assert.equal(name, "settings.section");
      register();
    },
    register: (entry) => {
      settingsEntry = entry;
      return () => {};
    },
  };
  const ctx = {
    locale,
    effect: (setup) => setup(),
    get: (name) => ({ slots, connection })[name],
  };

  plugin.apply(ctx);
  assert.equal(settingsEntry.locale, "skillManager");
  assert.equal(settingsEntry.label(), "Skill 管理");
  activeLocale = "en";
  assert.equal(settingsEntry.label(), "Skill manager");
});
