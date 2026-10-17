// Run only from trusted default-branch code. This helper reads review metadata;
// it never checks out or executes a pull request's contents.
const STATUS_CONTEXT = "Codex review gate";
const CHECKPOINT_CONTEXT = "Codex review checkpoint";
const SUMMARY_MARKER = "<!-- codex-pull-request-review-summary -->";
const TRUSTED_BOT = {
  id: 199175422,
  login: "chatgpt-codex-connector[bot]",
  type: "Bot",
  appId: 1144995,
  appSlug: "chatgpt-codex-connector",
};
const FAILED_REVIEW_STATES = new Set([
  "error",
  "errored",
  "failed",
  "failure",
  "canceled",
  "cancelled",
  "timed_out",
]);
const REQUEST_ASSOCIATIONS = new Set(["OWNER", "COLLABORATOR", "MEMBER"]);
const REVIEW_LABELS = {
  code_review: "Code Review",
  security_review: "Security Review",
};

function timestamp(value) {
  // A known trigger with an unreadable date cannot be proved older than a review.
  return Date.parse(value) || Number.MAX_SAFE_INTEGER;
}

function requestBarriers(checkpoint, comments, events, context) {
  for (const event of events)
    if (event.event === "base_ref_changed")
      checkpoint.b = Math.max(checkpoint.b, timestamp(event.created_at));
  if (context.payload.changes?.base)
    checkpoint.b = Math.max(
      checkpoint.b,
      timestamp(context.payload.pull_request?.updated_at),
    );
  // Include the triggering comment as well: deletion or an eventually
  // consistent listComments response must not ignore a new review request.
  const comment = context.payload.comment;
  const previous = context.payload.changes?.body?.from;
  const candidates = [...comments, comment];
  if (comment && previous) candidates.push({ ...comment, body: previous });
  for (const comment of candidates.filter(Boolean)) {
    if (!REQUEST_ASSOCIATIONS.has(comment.author_association)) continue;
    const commands = String(comment.body ?? "").matchAll(
      /^\s*@codex\s+(security\s+)?review(?:\s|$)/gim,
    );
    for (const command of commands) {
      const at = timestamp(comment.updated_at ?? comment.created_at);
      // Repository policy runs Security Review alongside a requested Code Review.
      if (!command[1]) checkpoint.c = Math.max(checkpoint.c, at);
      checkpoint.s = Math.max(checkpoint.s, at);
    }
  }
}

function reviewTime(summary, kind) {
  // The structured v1 state has no completion timestamps. Read each review's
  // own timestamp from the trusted summary table, never comment.updated_at:
  // completing Security Review can update a table with an old Code Review.
  const rows = summary.body
    .split("\n")
    .filter(
      (line) =>
        line.startsWith("|") && line.includes(`**${REVIEW_LABELS[kind]}**`),
    );
  if (rows.length !== 1) return 0;
  const times = [...rows[0].matchAll(/<relative-time\s+datetime="([^"]+)"/g)];
  return times.length === 1 ? Date.parse(times[0][1]) || 0 : 0;
}

function readCheckpoint(statuses, number) {
  const checkpoints = statuses
    .filter(
      (status) =>
        status.context === CHECKPOINT_CONTEXT &&
        status.state === "success" &&
        status.creator?.id === 41898282 &&
        status.creator?.login === "github-actions[bot]" &&
        status.creator?.type === "Bot",
    )
    .sort(
      (a, b) =>
        (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0) ||
        b.id - a.id,
    );
  for (const status of checkpoints) {
    const checkpoint = JSON.parse(status.description);
    if (checkpoint.p !== number) continue;
    if (
      checkpoint.v !== 1 ||
      ["b", "c", "s", "rc", "rs"].some(
        (key) => !Number.isSafeInteger(checkpoint[key]) || checkpoint[key] < 0,
      )
    )
      throw new Error(
        "Unrecognized Codex review checkpoint; cannot verify freshness.",
      );
    return checkpoint;
  }
  return { v: 1, p: number, b: 0, c: 0, s: 0, rc: 0, rs: 0 };
}

function summaryState(summary) {
  if (!summary) return null;
  const markers = [
    ...summary.body.matchAll(
      /<!--\s*codex-review-state:v1\s+([\s\S]*?)\s*-->/g,
    ),
  ];
  if (markers.length !== 1) return null;
  try {
    const state = JSON.parse(markers[0][1]);
    return state && typeof state === "object" && !Array.isArray(state)
      ? state
      : null;
  } catch {
    return null;
  }
}

function acknowledgeStarts(checkpoint, summary, sha, context) {
  const candidates = [summary];
  const comment = context.payload.comment;
  const previousBody = context.payload.changes?.body?.from;
  // A completed edit may supersede the queued workflow for its Running edit.
  // GitHub's signed event includes that previous body, with the same bot identity.
  if (comment && previousBody && isTrustedSummary(comment)) {
    const previous = { ...comment, body: previousBody };
    if (isTrustedSummary(previous)) candidates.push(previous);
  }
  for (const candidate of candidates) {
    const state = summaryState(candidate);
    for (const [kind, key] of [
      ["code_review", "rc"],
      ["security_review", "rs"],
    ])
      if (
        state?.[kind]?.commit_sha === sha &&
        ["running", "in_progress"].includes(state[kind].status)
      )
        checkpoint[key] = Math.max(
          checkpoint[key],
          reviewTime(candidate, kind),
        );
  }
}

function pullRequestNumber(context) {
  const value =
    context.payload.pull_request?.number ??
    context.payload.issue?.number ??
    context.payload.inputs?.pull_request_number;
  const number =
    typeof value === "string" && /^[1-9]\d*$/.test(value)
      ? Number(value)
      : value;
  if (!Number.isSafeInteger(number) || number <= 0)
    throw new Error("A positive pull request number is required.");
  return number;
}

function isTrustedSummary(comment) {
  return (
    comment.user?.id === TRUSTED_BOT.id &&
    comment.user?.login === TRUSTED_BOT.login &&
    comment.user?.type === TRUSTED_BOT.type &&
    comment.performed_via_github_app?.id === TRUSTED_BOT.appId &&
    comment.performed_via_github_app?.slug === TRUSTED_BOT.appSlug &&
    typeof comment.body === "string" &&
    comment.body.trimStart().startsWith(SUMMARY_MARKER)
  );
}

function latestSummary(comments) {
  return comments.filter(isTrustedSummary).sort((a, b) => {
    const updated =
      (Date.parse(b.updated_at) || 0) - (Date.parse(a.updated_at) || 0);
    return updated || b.id - a.id;
  })[0];
}

function evaluateSummary(summary, sha, checkpoint) {
  const pending = {
    state: "pending",
    description: "Waiting for Code Review and Security Review on this commit.",
  };
  const state = summaryState(summary);
  if (!state) return pending;
  const kinds = Object.keys(REVIEW_LABELS);
  const reviews = kinds.map((kind) => state[kind]);
  // An older clean result must never satisfy a newer commit or a split review.
  if (reviews.some((review) => !review || review.commit_sha !== sha))
    return pending;
  if (
    reviews.some(
      (review) =>
        FAILED_REVIEW_STATES.has(review.status) ||
        review.has_unresolved_findings === true,
    )
  )
    return {
      state: "failure",
      description: "Codex review failed or has unresolved findings.",
    };
  if (
    reviews.every(
      (review) =>
        review.status === "completed" &&
        review.has_unresolved_findings === false,
    ) &&
    kinds.every((kind) => {
      const isCode = kind === "code_review";
      const barrier = Math.max(checkpoint.b, checkpoint[isCode ? "c" : "s"]);
      const started = checkpoint[isCode ? "rc" : "rs"];
      // Completion after a retarget is insufficient: an older run can finish
      // later while reviewing the old diff. Require a fresh acknowledged start.
      return (
        !barrier || (started > barrier && reviewTime(summary, kind) >= started)
      );
    })
  )
    return {
      state: "success",
      description:
        "Code Review and Security Review completed with no unresolved findings.",
    };
  return pending;
}

export async function runCodexReviewGate({ github, context, core }) {
  const number = pullRequestNumber(context);
  const repo = { owner: context.repo.owner, repo: context.repo.repo };
  const getPullRequest = () =>
    github.rest.pulls.get({ ...repo, pull_number: number });
  let { data: pullRequest } = await getPullRequest();
  if (pullRequest.state !== "open") {
    core.info(`Skipping closed pull request #${number}.`);
    return { skipped: true };
  }
  const initialSha = pullRequest.head.sha;
  const publish = async (result, targetUrl = pullRequest.html_url) => {
    await github.rest.repos.createCommitStatus({
      ...repo,
      sha: pullRequest.head.sha,
      context: STATUS_CONTEXT,
      ...result,
      target_url: targetUrl,
    });
    core.info(`${STATUS_CONTEXT}: ${result.state} (${pullRequest.head.sha})`);
    return { ...result, sha: pullRequest.head.sha, pullRequestNumber: number };
  };
  if (pullRequest.base?.ref !== "main")
    return publish({
      state: "pending",
      description:
        "This pull request does not target main; Codex gate cannot pass.",
    });
  // Clear any earlier green status before further reads: a retry, deletion, or
  // API outage must not leave an old completion usable while we verify it.
  await publish({
    state: "pending",
    description: "Verifying the latest Code Review and Security Review.",
  });
  let summary;
  let checkpoint;
  try {
    const parameters = { ...repo, issue_number: number, per_page: 100 };
    const [comments, events, statuses] = await Promise.all([
      github.paginate(github.rest.issues.listComments, parameters),
      github.paginate(github.rest.issues.listEvents, parameters),
      github.paginate(github.rest.repos.listCommitStatusesForRef, {
        ...repo,
        ref: initialSha,
        per_page: 100,
      }),
    ]);
    summary = latestSummary(comments);
    checkpoint = readCheckpoint(statuses, number);
    requestBarriers(checkpoint, comments, events, context);
    acknowledgeStarts(checkpoint, summary, initialSha, context);
    const description = JSON.stringify(checkpoint);
    if (description.length > 140)
      throw new Error(
        "Codex review checkpoint exceeds the status description limit.",
      );
    await github.rest.repos.createCommitStatus({
      ...repo,
      sha: initialSha,
      context: CHECKPOINT_CONTEXT,
      state: "success",
      description,
      target_url: pullRequest.html_url,
    });
    // A push during the comments request must get a fresh pending result, not
    // inherit the successful result we just read for the previous head.
    ({ data: pullRequest } = await getPullRequest());
  } catch (error) {
    await publish({
      state: "failure",
      description: "Unable to verify the latest Codex review. Retry the gate.",
    });
    throw error;
  }
  if (pullRequest.state !== "open") {
    core.info(`Skipping closed pull request #${number}.`);
    return { skipped: true };
  }
  if (pullRequest.base?.ref !== "main")
    return publish({
      state: "pending",
      description:
        "This pull request no longer targets main; Codex gate cannot pass.",
    });
  if (pullRequest.head.sha !== initialSha)
    return publish({
      state: "pending",
      description:
        "Pull request changed; waiting for Codex reviews of the new commit.",
    });
  return publish(
    evaluateSummary(summary, initialSha, checkpoint),
    summary?.html_url,
  );
}
