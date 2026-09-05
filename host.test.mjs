import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { apply } from "./index.js";

for (const api of ["events", "snapshotEvents"]) {
  test(`${api}: activation survives resume and reinjects after compaction`, async () => {
    const home = await mkdtemp(join(tmpdir(), "dsh-skills-manager-"));
    const previousHome = process.env.DSH_HOME;
    process.env.DSH_HOME = home;
    const handlers = new Map();
    const warnings = [];
    const skill = {
      name: "review-code", description: "Review code", content: "Check the code.",
      provider: "filesystem", source: "user-dsh",
      invocation: { modelInvocable: true, userInvocable: true },
      metadata: {
        triggers: ["review"], activation: "auto",
        hooks: { PostToolUse: [{ tool: "bash", when: "review", action: "activate" }] },
      },
    };
    const events = [];
    const session = { header: { cwd: home }, surface: { nodes: [] } };
    if (api === "events") session.events = events;
    else session.snapshotEvents = function () {
      assert.equal(this, session);
      return Object.freeze([...events]);
    };
    const agent = { session };
    const signal = new AbortController().signal;
    const prompt = { source: { kind: "user" }, content: [{ type: "text", text: "review" }] };
    try {
      apply({
        on(name, handler) { handlers.set(name, handler); },
        events: { dispatch() {} },
        logger: { warn(message) { warnings.push(message); } },
        skills: { snapshot: async () => ({ complete: true, skills: [skill] }), get: async () => skill },
        tools: { register() {} },
        inject() {},
      });
      const step = () => handlers.get("agent/pre-step")(
        { agent, messages: [prompt], turn: 1, step: 1, signal },
        async () => ({ kind: "enter", messages: [prompt] }),
      );
      // A resumed session has a persisted activation but no manager memory.
      events.push({ type: "user/message", seq: 0, data: {
        source: { kind: "skill-manager", form: "activation", name: skill.name },
      } });
      session.surface.nodes = [0];
      assert.equal((await step()).messages.length, 1);
      const post = () => handlers.get("tools/post-execute")(
        { agent, name: "bash", arguments: {}, signal },
        { content: [{ type: "text", text: "review" }] },
        async () => ({ kind: "accept" }),
      );
      assert.equal((await post()).additionalContexts, undefined);

      session.surface.nodes = [];
      const activated = await step();
      assert.equal(activated.messages.length, 2);
      assert.equal(activated.messages[1].source.name, skill.name);
      events.push({ type: "user/message", seq: 1, data: activated.messages[1] });
      session.surface.nodes = [1];
      assert.equal((await step()).messages.length, 1);

      // Reading the committed marker clears the pending in-memory activation.
      session.surface.nodes = [];
      assert.equal((await post()).additionalContexts.length, 1);
      assert.deepEqual(warnings, []);
    } finally {
      await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 10 });
      if (previousHome === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = previousHome;
    }
  });
}

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
