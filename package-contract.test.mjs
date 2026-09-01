import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const dshPeerRange = ">=0.1.1-rc.2 <0.1.2 || >=0.1.2-alpha.3 <0.2.0-0";

function resolveInsideRoot(entry) {
  assert.equal(typeof entry, "string");
  assert.equal(isAbsolute(entry), false, `${entry} must be repository-relative`);
  const target = resolve(root, entry);
  const fromRoot = relative(root, target);
  assert.ok(fromRoot && fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`), `${entry} escapes the package root`);
  return target;
}

test("package declares an installable DSH bundle", async () => {
  assert.equal(manifest.name, "@wisdoverse/dsh-skills-manager");
  assert.notEqual(manifest.private, true);
  assert.equal(manifest.publishConfig?.access, "public");
  assert.equal(manifest.publishConfig?.registry, "https://registry.npmjs.org/");
  assert.equal(manifest.type, "module");
  assert.equal(manifest.engines?.node, "^22.19.0 || >=24.0.0");
  assert.equal(manifest.packageManager, "pnpm@11.19.0");
  assert.equal(manifest.repository?.url, "git+https://github.com/Wisdoverse/dsh-skills-manager-plugin.git");
  assert.ok(manifest.keywords.includes("dsh-plugin"));
  assert.equal(manifest.dsh?.bundle?.patch, "./cordis.patch.yml");

  for (const dependency of [
    "@deepseek-ai/dsh-home-paths",
    "@deepseek-ai/dsh-llm",
    "@deepseek-ai/dsh-skill",
    "@deepseek-ai/dsh-tools",
  ]) {
    assert.equal(manifest.dependencies?.[dependency], undefined, `${dependency} must come from the DSH host`);
    assert.equal(manifest.peerDependencies?.[dependency], dshPeerRange);
  }

  const patch = await readFile(resolveInsideRoot(manifest.dsh.bundle.patch), "utf8");
  assert.match(patch, /^- insert:\s*$/m);
  assert.match(patch, /^\s+- id: skill-manager\s*$/m);
  assert.match(patch, new RegExp(`^\\s+name:\\s+['\"]?${manifest.name}['\"]?\\s*$`, "m"));

  const entry = await readFile(resolveInsideRoot(manifest.main), "utf8");
  assert.ok(entry.includes(`version: "${manifest.version}"`), "Settings metadata must match the package version");
});

test("published files and exports stay inside the package root", async () => {
  const entries = new Set([manifest.main, ...manifest.files]);
  for (const target of Object.values(manifest.exports)) {
    if (typeof target === "string") entries.add(target);
  }

  for (const entry of entries) {
    const info = await stat(resolveInsideRoot(entry));
    assert.ok(info.isFile() || info.isDirectory(), `${entry} must exist`);
  }
});

test("marketplace screenshots resolve inside the repository", async () => {
  const screenshots = JSON.parse(await readFile(resolve(root, "screenshots.json"), "utf8"));
  assert.ok(screenshots.length >= 1 && screenshots.length <= 8);
  for (const screenshot of screenshots) {
    assert.ok((await stat(resolveInsideRoot(screenshot))).isFile(), `${screenshot} must exist`);
  }
});
