import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { apply } from "./index.js";

for (const [lifecycleEvent, currentDirectory] of [["agent/created", false], ["agent/created", true], ["agent/session-start", false]]) {
  test(`${lifecycleEvent} (${currentDirectory ? "current" : "legacy"} directory): SessionStart skill activates before the first step`, async () => {
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
    const cwd = currentDirectory ? join(home, "current") : home;
    const prompt = { source: { kind: "user" }, content: [{ type: "text", text: "hello" }] };
    try {
      apply({
        get() { return currentDirectory ? { get: () => cwd } : undefined; },
        on(name, handler) { handlers.set(name, handler); },
        events: { dispatch() {} },
        logger: { warn(message) { warnings.push(message); } },
        skills: {
          snapshot: async (options) => {
            assert.equal(options.cwd, cwd);
            return { complete: true, skills: [skill] };
          },
          get: async () => skill,
        },
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
        get() {},
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
      get() {},
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

test("current working directory selects project overrides, hooks, and scoped skill bodies", async () => {
  const home = await mkdtemp(join(tmpdir(), "dsh-skills-manager-"));
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  const original = join(home, "original");
  let cwd = original;
  const handlers = new Map();
  const warnings = [];
  let tool;
  const agent = { session: { header: { cwd: original }, surface: { nodes: [] }, snapshotEvents: () => [] } };
  const signal = new AbortController().signal;
  const prompt = { source: { kind: "user" }, content: [{ type: "text", text: "review" }] };
  const skill = {
    name: "project-guide", description: "Project guide", content: "Current project instructions.",
    provider: "filesystem", source: "project-dsh", invocation: { modelInvocable: true, userInvocable: true },
    metadata: { activation: "auto", triggers: ["review"], hooks: {
      PreToolUse: [{ tool: "bash", decision: "allow" }],
      UserPromptSubmit: { inject: "Current project prompt hook." },
    } },
  };
  const postSkill = {
    ...skill, name: "post-guide", content: "Current project tool instructions.",
    metadata: { hooks: { PostToolUse: [{ tool: "bash", when: "activate", action: "activate" }] } },
  };
  function checkLookup(options) {
    assert.equal(options.cwd, cwd);
    assert.equal(options.scope, agent);
  }
  try {
    await writeFile(join(home, "hook.cjs"), 'let input = ""; process.stdin.on("data", (chunk) => input += chunk); process.stdin.on("end", () => console.log(JSON.parse(input).cwd));');
    await writeFile(join(home, "skill-manager.json"), JSON.stringify({
      skills: { "project-guide": { scope: "project", cwd: original, mode: "off", hooks: {
        PreToolUse: [{ tool: "bash", decision: "deny", reason: "Original project policy." }],
      } } },
      skillSources: [{ url: "https://github.com/example/skills", clonePath: home, plugin: {
        name: "cwd-hook", hooks: [
          { event: "SessionStart", script: "hook.cjs" },
          { event: "UserPromptSubmit", script: "hook.cjs" },
        ],
      } }],
    }));
    apply({
      get(name) {
        assert.equal(name, "workingDirectory");
        return { get(session) { assert.equal(session, agent.session); return cwd; } };
      },
      on(name, handler) { handlers.set(name, handler); },
      events: { dispatch() {} },
      logger: { warn(message) { warnings.push(message); } },
      skills: {
        snapshot: async (options) => { checkLookup(options); return { complete: true, skills: [skill, postSkill] }; },
        get: async (name, options) => { checkLookup(options); return name === skill.name ? skill : postSkill; },
      },
      tools: { register(value) { tool = value; } },
      inject() {},
    });
    const pre = () => handlers.get("tools/pre-execute")(
      { agent, name: "bash", arguments: {}, signal }, async () => ({ kind: "allow" }),
    );
    const step = (turn) => handlers.get("agent/pre-step")(
      { agent, messages: [prompt], turn, step: 1, signal }, async () => ({ kind: "enter", messages: [prompt] }),
    );
    assert.equal((await pre()).kind, "deny");
    const first = await step(1);
    assert.equal(first.messages.some((message) => message.content[0].text.includes(skill.content)), false);
    assert.equal(first.messages.length, 3);
    for (const message of first.messages.slice(1)) assert.ok(message.content[0].text.endsWith(original));

    cwd = join(home, "current");
    assert.equal((await pre()).kind, "allow");
    const status = await tool.execute({ action: "status" }, { agent, signal });
    assert.equal(status.ok, true, status.message);
    assert.match(status.message, /project-guide: auto/);
    const second = await step(2);
    assert.ok(second.messages.some((message) => message.content[0].text.includes(skill.content)));
    assert.ok(second.messages.some((message) => message.content[0].text.includes("Current project prompt hook.")));
    assert.ok(second.messages.some((message) => message.content[0].text.endsWith(cwd)));
    const post = await handlers.get("tools/post-execute")(
      { agent, name: "bash", arguments: {}, signal },
      { content: [{ type: "text", text: "activate" }] }, async () => ({ kind: "accept" }),
    );
    assert.match(post.additionalContexts?.[0].content[0].text ?? "", /Current project tool instructions/);
    cwd = original;
    assert.equal((await pre()).kind, "deny");
    assert.deepEqual(warnings, []);
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 10 });
  }
});
