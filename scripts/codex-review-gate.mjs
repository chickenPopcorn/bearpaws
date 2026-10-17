// Run only from trusted default-branch code. This helper reads review metadata;
// it never checks out or executes a pull request's contents.
const STATUS_CONTEXT = "Codex review gate";
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

function evaluateSummary(summary, sha) {
  const pending = {
    state: "pending",
    description: "Waiting for Code Review and Security Review on this commit.",
  };
  if (!summary) return pending;
  const markers = [
    ...summary.body.matchAll(
      /<!--\s*codex-review-state:v1\s+([\s\S]*?)\s*-->/g,
    ),
  ];
  if (markers.length !== 1) return pending;
  let state;
  try {
    state = JSON.parse(markers[0][1]);
  } catch {
    return pending;
  }
  if (!state || typeof state !== "object" || Array.isArray(state))
    return pending;
  const reviews = [state.code_review, state.security_review];
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
    )
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
  // Clear any earlier green status before further reads: a retry, deletion, or
  // API outage must not leave an old completion usable while we verify it.
  await publish({
    state: "pending",
    description: "Verifying the latest Code Review and Security Review.",
  });
  let summary;
  try {
    const comments = await github.paginate(github.rest.issues.listComments, {
      ...repo,
      issue_number: number,
      per_page: 100,
    });
    summary = latestSummary(comments);
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
  if (pullRequest.head.sha !== initialSha)
    return publish({
      state: "pending",
      description:
        "Pull request changed; waiting for Codex reviews of the new commit.",
    });
  return publish(evaluateSummary(summary, initialSha), summary?.html_url);
}
