import { describe, expect, it, vi } from "vitest";
import { runCodexReviewGate } from "../scripts/codex-review-gate.mjs";

const HEAD = "1".repeat(40);
const OLD_HEAD = "2".repeat(40);
const PR_URL = "https://github.com/chickenPopcorn/bearpaws/pull/7";
const cleanReview = (sha = HEAD) => ({
  commit_sha: sha,
  status: "completed",
  has_any_findings: false,
  has_unresolved_findings: false,
});
const summary = (
  state = {
    code_review: cleanReview(),
    security_review: cleanReview(),
  },
  id = 10,
  updatedAt = "2026-10-17T06:00:00Z",
) => ({
  id,
  user: {
    id: 199175422,
    login: "chatgpt-codex-connector[bot]",
    type: "Bot",
  },
  performed_via_github_app: { id: 1144995, slug: "chatgpt-codex-connector" },
  body: `<!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v1 ${JSON.stringify(state)} -->`,
  updated_at: updatedAt,
  html_url: `${PR_URL}#issuecomment-${id}`,
});
const BEFORE = "2026-10-17T06:00:00Z";
const REQUEST = "2026-10-17T06:01:00Z";
const START = "2026-10-17T06:02:00Z";
const FINISH = "2026-10-17T06:03:00Z";
const withTimes = (state, code = FINISH, security = FINISH) => {
  const comment = summary(state, 10, FINISH);
  comment.body += `\n| 📝 **Code Review** | ${state.code_review?.status} <relative-time datetime="${code}">${code}</relative-time> |\n| 🔒 **Security Review** | ${state.security_review?.status} <relative-time datetime="${security}">${security}</relative-time> |`;
  return comment;
};
const completed = () => ({
  code_review: cleanReview(),
  security_review: cleanReview(),
});
const running = () => ({
  code_review: { ...cleanReview(), status: "running" },
  security_review: { ...cleanReview(), status: "running" },
});
const command = (body = "@codex review", association = "OWNER") => ({
  id: 20,
  body,
  author_association: association,
  created_at: REQUEST,
  updated_at: REQUEST,
});
const checkpoint = (values = {}) => ({
  context: "Codex review checkpoint",
  state: "success",
  creator: { id: 41898282, login: "github-actions[bot]", type: "Bot" },
  description: JSON.stringify({
    v: 1,
    p: 7,
    b: 0,
    c: 0,
    s: 0,
    rc: 0,
    rs: 0,
    ...values,
  }),
  created_at: FINISH,
  id: 100,
});
const savedCheckpoint = (publish) =>
  JSON.parse(
    publish.mock.calls.findLast(
      ([status]) => status.context === "Codex review checkpoint",
    )[0].description,
  );

function setup(comments = [], events = [], statuses = []) {
  const pullRequest = {
    state: "open",
    head: { sha: HEAD },
    base: { ref: "main" },
    html_url: PR_URL,
  };
  const get = vi.fn().mockResolvedValue({ data: pullRequest });
  const publish = vi.fn().mockResolvedValue({});
  const listComments = vi.fn();
  const listEvents = vi.fn();
  const listCommitStatusesForRef = vi.fn();
  const github = {
    rest: {
      pulls: { get },
      issues: { listComments, listEvents },
      repos: { createCommitStatus: publish, listCommitStatusesForRef },
    },
    paginate: vi
      .fn()
      .mockImplementation((method) =>
        Promise.resolve(
          method === listEvents
            ? events
            : method === listComments
              ? comments
              : statuses,
        ),
      ),
  };
  const context = {
    repo: { owner: "chickenPopcorn", repo: "bearpaws" },
    payload: { pull_request: { number: 7 } },
  };
  const core = { info: vi.fn() };
  return {
    run: () => runCodexReviewGate({ github, context, core }),
    context,
    github,
    get,
    publish,
    pullRequest,
  };
}

describe("Codex review merge gate", () => {
  it("keeps a fresh PR pending and publishes the explicit status on its head", async () => {
    const { run, github, get, publish } = setup();
    await expect(run()).resolves.toMatchObject({ state: "pending", sha: HEAD });
    expect(get).toHaveBeenCalledWith({
      owner: "chickenPopcorn",
      repo: "bearpaws",
      pull_number: 7,
    });
    expect(github.paginate).toHaveBeenCalledWith(
      github.rest.issues.listComments,
      {
        owner: "chickenPopcorn",
        repo: "bearpaws",
        issue_number: 7,
        per_page: 100,
      },
    );
    expect(publish).toHaveBeenCalledTimes(3);
    expect(publish).toHaveBeenLastCalledWith({
      owner: "chickenPopcorn",
      repo: "bearpaws",
      sha: HEAD,
      context: "Codex review gate",
      state: "pending",
      description: expect.any(String),
      target_url: PR_URL,
    });
  });

  it("succeeds only when both trusted reviews completed cleanly on the latest head", async () => {
    const comment = summary();
    const { run, publish } = setup([comment]);
    await expect(run()).resolves.toMatchObject({ state: "success", sha: HEAD });
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        sha: HEAD,
        context: "Codex review gate",
        state: "success",
        target_url: comment.html_url,
      }),
    );
  });

  it.each([
    {
      code_review: cleanReview(OLD_HEAD),
      security_review: cleanReview(OLD_HEAD),
    },
    { code_review: cleanReview(), security_review: cleanReview(OLD_HEAD) },
    { code_review: cleanReview(OLD_HEAD), security_review: cleanReview() },
    { code_review: cleanReview() },
    { security_review: cleanReview() },
    {},
    null,
    [],
  ])(
    "does not accept missing, stale or split-commit reviews: %j",
    async (state) => {
      await expect(setup([summary(state)]).run()).resolves.toMatchObject({
        state: "pending",
      });
    },
  );

  it.each(["code_review", "security_review"])(
    "blocks unresolved findings from %s even if its review completed",
    async (kind) => {
      const state = {
        code_review: cleanReview(),
        security_review: cleanReview(),
        [kind]: { ...cleanReview(), has_unresolved_findings: true },
      };
      await expect(setup([summary(state)]).run()).resolves.toMatchObject({
        state: "failure",
      });
    },
  );

  it("allows completed findings that are all explicitly resolved", async () => {
    await expect(
      setup([
        summary({
          code_review: { ...cleanReview(), has_any_findings: true },
          security_review: cleanReview(),
        }),
      ]).run(),
    ).resolves.toMatchObject({ state: "success" });
  });

  it.each(["error", "failed", "failure", "canceled", "cancelled", "timed_out"])(
    "fails closed when the newest review retry reports %s",
    async (status) => {
      const oldSuccess = summary(undefined, 100, "2026-10-17T05:00:00Z");
      const newerRetry = summary(
        {
          code_review: { ...cleanReview(), status },
          security_review: cleanReview(),
        },
        10,
      );
      await expect(
        setup([newerRetry, oldSuccess]).run(),
      ).resolves.toMatchObject({ state: "failure" });
    },
  );

  it.each(["queued", "running", "in_progress", "skipped", "unknown"])(
    "keeps a newer %s retry pending instead of accepting an older success",
    async (status) => {
      const oldSuccess = summary(undefined, 100, "2026-10-17T05:00:00Z");
      const retry = summary({
        code_review: cleanReview(),
        security_review: { ...cleanReview(), status },
      });
      await expect(setup([oldSuccess, retry]).run()).resolves.toMatchObject({
        state: "pending",
      });
    },
  );

  it("requires an explicit false unresolved-findings flag", async () => {
    await expect(
      setup([
        summary({
          code_review: { commit_sha: HEAD, status: "completed" },
          security_review: cleanReview(),
        }),
      ]).run(),
    ).resolves.toMatchObject({ state: "pending" });
  });

  it.each([
    { user: { id: 123, login: "chatgpt-codex-connector[bot]", type: "Bot" } },
    { user: { id: 199175422, login: "spoof", type: "Bot" } },
    {
      user: {
        id: 199175422,
        login: "chatgpt-codex-connector[bot]",
        type: "User",
      },
    },
    { performed_via_github_app: { id: 123, slug: "chatgpt-codex-connector" } },
    { performed_via_github_app: { id: 1144995, slug: "spoof" } },
    { performed_via_github_app: undefined },
  ])("ignores spoofed completion identity: %j", async (identity) => {
    const comment = { ...summary(), ...identity };
    await expect(setup([comment]).run()).resolves.toMatchObject({
      state: "pending",
    });
  });

  it("does not treat completion text quoted in an ordinary bot comment as a summary", async () => {
    const comment = summary();
    comment.body = `Here is code from the PR:\n${comment.body}`;
    await expect(setup([comment]).run()).resolves.toMatchObject({
      state: "pending",
    });
  });

  it.each([
    "<!-- codex-pull-request-review-summary -->",
    "<!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v1 invalid -->",
    `${summary().body}\n${summary().body}`,
  ])("keeps a malformed latest summary pending", async (body) => {
    const malformed = { ...summary(), body };
    await expect(
      setup([summary(undefined, 100, "2026-10-17T05:00:00Z"), malformed]).run(),
    ).resolves.toMatchObject({ state: "pending" });
  });

  it("uses the newest comment ID to break equal updated-time ties", async () => {
    const pending = summary(
      {
        code_review: { ...cleanReview(), status: "running" },
        security_review: cleanReview(),
      },
      11,
    );
    await expect(setup([pending, summary()]).run()).resolves.toMatchObject({
      state: "pending",
    });
  });

  it("does not let a later untrusted comment override the trusted summary", async () => {
    const spoof = {
      ...summary({}, 20, "2026-10-17T07:00:00Z"),
      user: { id: 123, login: "attacker", type: "User" },
    };
    await expect(setup([summary(), spoof]).run()).resolves.toMatchObject({
      state: "success",
    });
  });

  it("publishes pending on a new head if a push races the comments request", async () => {
    const { run, get, pullRequest, publish } = setup([summary()]);
    get.mockResolvedValueOnce({ data: pullRequest }).mockResolvedValueOnce({
      data: { ...pullRequest, head: { sha: OLD_HEAD } },
    });
    await expect(run()).resolves.toMatchObject({
      state: "pending",
      sha: OLD_HEAD,
    });
    expect(publish).toHaveBeenLastCalledWith(
      expect.objectContaining({ sha: OLD_HEAD, state: "pending" }),
    );
  });

  it.each(["initial", "refresh"])(
    "skips a PR closed at the %s read without posting a status",
    async (when) => {
      const { run, get, github, pullRequest, publish } = setup([summary()]);
      if (when === "initial")
        get.mockResolvedValue({ data: { ...pullRequest, state: "closed" } });
      else
        get.mockResolvedValueOnce({ data: pullRequest }).mockResolvedValueOnce({
          data: { ...pullRequest, state: "closed" },
        });
      await expect(run()).resolves.toEqual({ skipped: true });
      if (when === "initial") {
        expect(publish).not.toHaveBeenCalled();
        expect(github.paginate).not.toHaveBeenCalled();
      } else {
        expect(publish).toHaveBeenCalledTimes(2);
        expect(publish).toHaveBeenCalledWith(
          expect.objectContaining({ state: "pending" }),
        );
      }
    },
  );

  it.each(["comments", "refresh"])(
    "replaces prior success with failure when the %s API cannot verify reviews",
    async (failedRequest) => {
      const { run, get, github, pullRequest, publish } = setup([summary()]);
      const error = new Error("GitHub unavailable");
      if (failedRequest === "comments")
        github.paginate.mockRejectedValue(error);
      else
        get
          .mockResolvedValueOnce({ data: pullRequest })
          .mockRejectedValueOnce(error);
      await expect(run()).rejects.toBe(error);
      expect(publish).toHaveBeenLastCalledWith(
        expect.objectContaining({ sha: HEAD, state: "failure" }),
      );
    },
  );

  it("propagates a failed status publication without claiming success", async () => {
    const { run, publish } = setup([summary()]);
    publish.mockRejectedValue(new Error("Status write rejected"));
    await expect(run()).rejects.toThrow("Status write rejected");
  });

  it.each([{ issue: { number: 7 } }, { inputs: { pull_request_number: "7" } }])(
    "accepts comment and manual dispatch PR numbers: %j",
    async (payload) => {
      const { run, context } = setup();
      context.payload = payload;
      await expect(run()).resolves.toMatchObject({ pullRequestNumber: 7 });
    },
  );

  it.each([undefined, "", "7x", "1.5", "-1", 0, -1, 1.5, "9007199254740992"])(
    "rejects invalid PR numbers before API calls: %j",
    async (value) => {
      const { run, context, get } = setup();
      context.payload = { inputs: { pull_request_number: value } };
      await expect(run()).rejects.toThrow("positive pull request number");
      expect(get).not.toHaveBeenCalled();
    },
  );

  it("publishes pending without reading reviews for a PR targeting another branch", async () => {
    const { run, get, github, pullRequest, publish } = setup([summary()]);
    get.mockResolvedValue({
      data: { ...pullRequest, base: { ref: "release" } },
    });
    await expect(run()).resolves.toMatchObject({ state: "pending" });
    expect(github.paginate).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        context: "Codex review gate",
        state: "pending",
        sha: HEAD,
      }),
    );
  });

  it("cannot pass if the base changes away from main during verification", async () => {
    const { run, get, pullRequest, publish } = setup([summary()]);
    get.mockResolvedValueOnce({ data: pullRequest }).mockResolvedValueOnce({
      data: { ...pullRequest, base: { ref: "release" } },
    });
    await expect(run()).resolves.toMatchObject({ state: "pending" });
    expect(publish).not.toHaveBeenCalledWith(
      expect.objectContaining({
        context: "Codex review gate",
        state: "success",
      }),
    );
  });

  it("retains retarget barriers across later refreshes and requires fresh starts for both reviews", async () => {
    const events = [{ event: "base_ref_changed", created_at: REQUEST }];
    const first = setup([withTimes(completed())], events);
    await expect(first.run()).resolves.toMatchObject({ state: "pending" });
    const saved = savedCheckpoint(first.publish);
    expect(saved.b).toBe(Date.parse(REQUEST));
    const next = setup([withTimes(completed())], [], [checkpoint(saved)]);
    await expect(next.run()).resolves.toMatchObject({ state: "pending" });
    const fresh = setup([withTimes(running(), START, START)], events, [
      checkpoint(saved),
    ]);
    await expect(fresh.run()).resolves.toMatchObject({ state: "pending" });
    const finished = setup([withTimes(completed())], events, [
      checkpoint(savedCheckpoint(fresh.publish)),
    ]);
    await expect(finished.run()).resolves.toMatchObject({ state: "success" });
  });

  it("does not accept an old run that finishes after a retarget", async () => {
    const oldStart = withTimes(running(), BEFORE, BEFORE);
    const result = setup(
      [withTimes(completed())],
      [{ event: "base_ref_changed", created_at: REQUEST }],
    );
    result.context.payload.comment = withTimes(completed());
    result.context.payload.changes = { body: { from: oldStart.body } };
    await expect(result.run()).resolves.toMatchObject({ state: "pending" });
    expect(savedCheckpoint(result.publish)).toMatchObject({
      rc: Date.parse(BEFORE),
      rs: Date.parse(BEFORE),
    });
  });

  it("recovers fresh running starts from the trusted completed edit's previous body", async () => {
    const finished = withTimes(completed());
    const { run, context, publish } = setup(
      [finished],
      [{ event: "base_ref_changed", created_at: REQUEST }],
    );
    context.payload.comment = finished;
    context.payload.changes = {
      body: { from: withTimes(running(), START, START).body },
    };
    await expect(run()).resolves.toMatchObject({ state: "success" });
    expect(savedCheckpoint(publish)).toMatchObject({
      rc: Date.parse(START),
      rs: Date.parse(START),
    });
  });

  it("requires both starts after retarget, even when both completion times are new", async () => {
    const { run } = setup(
      [withTimes(completed())],
      [],
      [
        checkpoint({
          b: Date.parse(REQUEST),
          rc: Date.parse(START),
          rs: Date.parse(BEFORE),
        }),
      ],
    );
    await expect(run()).resolves.toMatchObject({ state: "pending" });
  });

  it("uses the base-change payload immediately before issue events are visible", async () => {
    const { run, context, publish } = setup([withTimes(completed())]);
    context.payload.pull_request.updated_at = REQUEST;
    context.payload.changes = { base: { ref: { from: "release" } } };
    await expect(run()).resolves.toMatchObject({ state: "pending" });
    expect(savedCheckpoint(publish).b).toBe(Date.parse(REQUEST));
  });

  it.each(["OWNER", "COLLABORATOR", "MEMBER"])(
    "invalidates both reviews when an authorized %s requests Code Review",
    async (association) => {
      const { run, publish } = setup([
        withTimes(completed()),
        command("@codex review", association),
      ]);
      await expect(run()).resolves.toMatchObject({ state: "pending" });
      expect(savedCheckpoint(publish)).toMatchObject({
        c: Date.parse(REQUEST),
        s: Date.parse(REQUEST),
      });
    },
  );

  it("keeps code-triggered Security Review pending when only a fresh Code Review has run", async () => {
    const { run } = setup(
      [withTimes(completed()), command()],
      [],
      [checkpoint({ rc: Date.parse(START) })],
    );
    await expect(run()).resolves.toMatchObject({ state: "pending" });
  });

  it("a Security Review command requires only a fresh security run", async () => {
    const { run, publish } = setup(
      [withTimes(completed(), BEFORE), command("@codex security review")],
      [],
      [checkpoint({ rs: Date.parse(START) })],
    );
    await expect(run()).resolves.toMatchObject({ state: "success" });
    expect(savedCheckpoint(publish)).toMatchObject({
      c: 0,
      s: Date.parse(REQUEST),
    });
  });

  it("a deleted request remains pending on subsequent bot updates", async () => {
    const first = setup([withTimes(completed())]);
    first.context.payload.comment = command();
    first.context.payload.action = "deleted";
    await expect(first.run()).resolves.toMatchObject({ state: "pending" });
    const saved = savedCheckpoint(first.publish);
    await expect(
      setup([withTimes(completed())], [], [checkpoint(saved)]).run(),
    ).resolves.toMatchObject({ state: "pending" });
    const fresh = setup([withTimes(completed())], [], [checkpoint(saved)]);
    fresh.context.payload.comment = withTimes(completed());
    fresh.context.payload.changes = {
      body: { from: withTimes(running(), START, START).body },
    };
    await expect(fresh.run()).resolves.toMatchObject({ state: "success" });
  });

  it("preserves a command edited out of the triggering comment", async () => {
    const { run, context, publish } = setup([withTimes(completed())]);
    context.payload.comment = command("Thanks");
    context.payload.changes = { body: { from: "@codex review" } };
    await expect(run()).resolves.toMatchObject({ state: "pending" });
    expect(savedCheckpoint(publish).c).toBe(Date.parse(REQUEST));
  });

  it.each([
    command("@codex review", "NONE"),
    command("Please see `@codex review`"),
    command("> @codex review"),
  ])(
    "does not invalidate clean reviews for an unauthorized or quoted request",
    async (comment) => {
      await expect(setup([summary(), comment]).run()).resolves.toMatchObject({
        state: "success",
      });
    },
  );

  it("does not use a later summary edit time as a review completion timestamp", async () => {
    const comment = withTimes(completed(), BEFORE, FINISH);
    comment.updated_at = FINISH;
    await expect(
      setup(
        [comment],
        [],
        [
          checkpoint({
            c: Date.parse(REQUEST),
            rc: Date.parse(START),
          }),
        ],
      ).run(),
    ).resolves.toMatchObject({ state: "pending" });
  });

  it("missing per-review timestamps cannot satisfy a freshness barrier", async () => {
    await expect(
      setup(
        [summary()],
        [],
        [
          checkpoint({
            c: Date.parse(REQUEST),
            rc: Date.parse(START),
          }),
        ],
      ).run(),
    ).resolves.toMatchObject({ state: "pending" });
  });

  it("ignores spoofed previous-body metadata when acknowledging fresh starts", async () => {
    const { run, context } = setup([withTimes(completed()), command()]);
    context.payload.comment = {
      ...withTimes(completed()),
      user: { id: 123, login: "attacker", type: "User" },
    };
    context.payload.changes = {
      body: { from: withTimes(running(), START, START).body },
    };
    await expect(run()).resolves.toMatchObject({ state: "pending" });
  });

  it("does not acknowledge a running review of a different commit", async () => {
    const oldRun = running();
    oldRun.code_review.commit_sha = OLD_HEAD;
    const { run, context, publish } = setup([
      withTimes(completed()),
      command(),
    ]);
    context.payload.comment = withTimes(completed());
    context.payload.changes = {
      body: { from: withTimes(oldRun, START, START).body },
    };
    await expect(run()).resolves.toMatchObject({ state: "pending" });
    expect(savedCheckpoint(publish).rc).toBe(0);
  });

  it("binds checkpoints to the PR number on this commit", async () => {
    const other = checkpoint({ p: 8, b: Date.parse(REQUEST) });
    await expect(setup([summary()], [], [other]).run()).resolves.toMatchObject({
      state: "success",
    });
  });

  it("ignores a spoofed checkpoint that claims fresh running starts", async () => {
    const spoof = checkpoint({ rc: Date.parse(START), rs: Date.parse(START) });
    spoof.creator.id = 123;
    await expect(
      setup([withTimes(completed()), command()], [], [spoof]).run(),
    ).resolves.toMatchObject({ state: "pending" });
  });

  it.each([
    "invalid json",
    JSON.stringify({ v: 2, p: 7, b: 0, c: 0, s: 0, rc: 0, rs: 0 }),
    JSON.stringify({ v: 1, p: 7, b: 0, c: -1, s: 0, rc: 0, rs: 0 }),
  ])("fails closed for a malformed trusted checkpoint", async (description) => {
    const status = { ...checkpoint(), description };
    const { run, publish } = setup([summary()], [], [status]);
    await expect(run()).rejects.toBeInstanceOf(Error);
    expect(publish).toHaveBeenLastCalledWith(
      expect.objectContaining({
        context: "Codex review gate",
        state: "failure",
      }),
    );
  });

  it("serializes maximum timestamp barriers within GitHub's 140-character limit", async () => {
    const { run, publish } = setup(
      [summary(), { ...command(), updated_at: "unreadable" }],
      [{ event: "base_ref_changed", created_at: "unreadable" }],
    );
    await expect(run()).resolves.toMatchObject({ state: "pending" });
    const status = publish.mock.calls.find(
      ([value]) => value.context === "Codex review checkpoint",
    )[0];
    expect(status.description.length).toBeLessThanOrEqual(140);
    expect(savedCheckpoint(publish)).toMatchObject({
      b: Number.MAX_SAFE_INTEGER,
      c: Number.MAX_SAFE_INTEGER,
      s: Number.MAX_SAFE_INTEGER,
    });
  });

  it.each(["listEvents", "listCommitStatusesForRef"])(
    "fails the gate when %s cannot verify persisted freshness",
    async (method) => {
      const { run, github, publish } = setup([summary()]);
      const error = new Error("GitHub unavailable");
      const target = github.rest.issues[method] ?? github.rest.repos[method];
      github.paginate.mockImplementation((called) =>
        called === target ? Promise.reject(error) : Promise.resolve([]),
      );
      await expect(run()).rejects.toBe(error);
      expect(publish).toHaveBeenLastCalledWith(
        expect.objectContaining({
          context: "Codex review gate",
          state: "failure",
        }),
      );
    },
  );

  it("cannot publish a passing gate if saving the checkpoint fails", async () => {
    const { run, publish } = setup([summary()]);
    publish
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("Checkpoint rejected"));
    await expect(run()).rejects.toThrow("Checkpoint rejected");
    expect(publish).toHaveBeenLastCalledWith(
      expect.objectContaining({
        context: "Codex review gate",
        state: "failure",
      }),
    );
  });
});
