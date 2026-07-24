export const COMMENT_MARKER = "<!-- tinify-compress-action -->";

export function buildCommentBody(markdownSummary: string): string {
  return `${COMMENT_MARKER}\n${markdownSummary}`;
}

/** Minimal Octokit surface used for sticky comments; tests inject a fake. */
export interface IssuesApi {
  listComments(params: {
    owner: string;
    repo: string;
    issue_number: number;
    per_page: number;
    page: number;
  }): Promise<{ data: Array<{ id: number; body?: string }> }>;
  updateComment(params: {
    owner: string;
    repo: string;
    comment_id: number;
    body: string;
  }): Promise<unknown>;
  createComment(params: {
    owner: string;
    repo: string;
    issue_number: number;
    body: string;
  }): Promise<unknown>;
}

/** GitHub caps an issue-comment body at 65,536 chars; stay safely under. */
const MAX_COMMENT_BODY = 65_000;

function capCommentBody(body: string): string {
  if (body.length <= MAX_COMMENT_BODY) return body;
  const notice = "\n\n_(report truncated to fit GitHub's comment size limit)_";
  return `${body.slice(0, MAX_COMMENT_BODY - notice.length)}${notice}`;
}

/**
 * Creates or updates the single sticky PR comment identified by
 * {@link COMMENT_MARKER}. Scans every page of comments so the marker is found
 * on busy PRs (finding only the first 100 would spawn a duplicate each run).
 */
export async function upsertStickyComment(
  issues: IssuesApi,
  target: { owner: string; repo: string; issueNumber: number },
  markdownSummary: string,
): Promise<"created" | "updated"> {
  const body = capCommentBody(buildCommentBody(markdownSummary));
  const perPage = 100;
  let existingId: number | undefined;
  for (let page = 1; ; page += 1) {
    const { data: comments } = await issues.listComments({
      owner: target.owner,
      repo: target.repo,
      issue_number: target.issueNumber,
      per_page: perPage,
      page,
    });
    const found = comments.find((comment) => comment.body?.includes(COMMENT_MARKER));
    if (found !== undefined) {
      existingId = found.id;
      break;
    }
    if (comments.length < perPage) break; // last page reached
  }
  if (existingId !== undefined) {
    await issues.updateComment({
      owner: target.owner,
      repo: target.repo,
      comment_id: existingId,
      body,
    });
    return "updated";
  }
  await issues.createComment({
    owner: target.owner,
    repo: target.repo,
    issue_number: target.issueNumber,
    body,
  });
  return "created";
}
