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

function setup(comments = []) {
  const pullRequest = {
    state: "open",
    head: { sha: HEAD },
    html_url: PR_URL,
  };
  const get = vi.fn().mockResolvedValue({ data: pullRequest });
  const publish = vi.fn().mockResolvedValue({});
  const listComments = vi.fn();
  const github = {
    rest: {
      pulls: { get },
      issues: { listComments },
      repos: { createCommitStatus: publish },
    },
    paginate: vi.fn().mockResolvedValue(comments),
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
    expect(publish).toHaveBeenCalledTimes(2);
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
        expect(publish).toHaveBeenCalledTimes(1);
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
});
