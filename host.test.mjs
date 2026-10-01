import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { apply } from "./index.js";

for (const lifecycleEvent of ["agent/created", "agent/session-start"]) {
  test(`${lifecycleEvent}: SessionStart skill activates before the first step`, async () => {
    const home = await mkdtemp(join(tmpdir(), "dsh-skills-manager-"));
    const previousHome = process.env.DSH_HOME;
    process.env.DSH_HOME = home;
    const handlers = new Map();
    const warnings = [];
    const skill = {
      name: "startup-guide", description: "Startup guide", content: "Read this first.",
      provider: "filesystem", source: "user-dsh", invocation: { modelInvocable: true, userInvocable: true },
      metadata: { hooks: { SessionStart: { activate: true } } },
    };
    const agent = { session: { header: { cwd: home }, surface: { nodes: [] }, snapshotEvents: () => [] } };
    const prompt = { source: { kind: "user" }, content: [{ type: "text", text: "hello" }] };
    try {
      apply({
        on(name, handler) { handlers.set(name, handler); },
        events: { dispatch() {} },
        logger: { warn(message) { warnings.push(message); } },
        skills: { snapshot: async () => ({ complete: true, skills: [skill] }), get: async () => skill },
        tools: { register() {} },
        inject() {},
      });
      await handlers.get(lifecycleEvent)({ agent, source: "startup" });
      const decision = await handlers.get("agent/pre-step")(
        { agent, messages: [prompt], turn: 1, step: 1, signal: new AbortController().signal },
        async () => ({ kind: "enter", messages: [prompt] }),
      );
      assert.equal(decision.messages.length, 2, warnings.join("; "));
      assert.match(decision.messages[1].content[0].text, /Read this first/);
      assert.equal(decision.messages[1].source.kind, "plugin:dsh-skills-manager");
      assert.equal(decision.messages[1].source.plugin, undefined);
    } finally {
      if (previousHome === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = previousHome;
      await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 10 });
    }
  });
}

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
        source: {
          kind: "plugin",
          plugin: "dsh-skills-manager",
          form: "notice",
          summary: JSON.stringify({ form: "activation", name: skill.name }),
        },
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
      assert.deepEqual(
        { kind: activated.messages[1].source.kind, form: activated.messages[1].source.form },
        { kind: "plugin:dsh-skills-manager", form: "notice" },
      );
      assert.equal(JSON.parse(activated.messages[1].source.summary).name, skill.name);
      events.push({ type: "user/message", seq: 1, data: activated.messages[1] });
      session.surface.nodes = [1];
      assert.equal((await step()).messages.length, 1);

      // Reading the committed marker clears the pending in-memory activation.
      session.surface.nodes = [];
      const context = (await post()).additionalContexts;
      assert.equal(context.length, 1);
      assert.equal(context[0].source.kind, "plugin:dsh-skills-manager");
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
  let route;

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
      inject(seats, setup) {
        assert.deepEqual(seats, ["connection", "agentPresets"]);
        setup({
          agentPresets: { standingKeyFor: async () => undefined },
          connection: {
            fetch: {
              register(value) {
                route = value;
                return () => {};
              },
            },
          },
          effect: (start) => start(),
        });
      },
    });

    assert.equal(route.path, "/api/skill-manager");
    assert.deepEqual(route.methods, ["POST"]);
    assert.equal((await route.fetch(new Request("http://localhost/api/skill-manager", { method: "POST" }))).status, 415);
    const response = await route.fetch(new Request("http://localhost/api/skill-manager", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint: "list", payload: {} }),
    }));
    const result = await response.json();
    assert.equal(result.ok, true);
    assert.equal(Array.isArray(result.value.events), true);
    assert.equal(result.value.events[0]?.kind, "state");
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  }
});
