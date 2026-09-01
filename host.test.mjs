import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { apply } from "./index.js";

test("a fresh DSH home returns a valid Settings view", async () => {
  const home = await mkdtemp(join(tmpdir(), "dsh-skills-manager-"));
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  let rpcHandler;

  try {
    apply({
      on() {},
      events: { dispatch() {} },
      logger: { warn() {} },
      skills: {
        snapshot: async () => ({ complete: true, skills: [] }),
        get: async () => undefined,
      },
      tools: { register() {} },
      inject(_seats, setup) {
        setup({
          agentPresets: { standingKeyFor: async () => undefined },
          connection: {
            rpc: {
              handle(_channel, handler) {
                rpcHandler = handler;
                return () => {};
              },
            },
          },
          effect: (start) => start(),
        });
      },
    });

    assert.equal(typeof rpcHandler, "function");
    const response = await rpcHandler("list", {});
    assert.equal(response.ok, true);
    assert.equal(Array.isArray(response.value.events), true);
    assert.equal(response.value.events[0]?.kind, "state");
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  }
});
