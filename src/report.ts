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

/**
 * Creates or updates the single sticky PR comment identified by
 * {@link COMMENT_MARKER}.
 */
export async function upsertStickyComment(
  issues: IssuesApi,
  target: { owner: string; repo: string; issueNumber: number },
  markdownSummary: string,
): Promise<"created" | "updated"> {
  const body = buildCommentBody(markdownSummary);
  const { data: comments } = await issues.listComments({
    owner: target.owner,
    repo: target.repo,
    issue_number: target.issueNumber,
    per_page: 100,
  });
  const existing = comments.find((comment) => comment.body?.includes(COMMENT_MARKER));
  if (existing !== undefined) {
    await issues.updateComment({
      owner: target.owner,
      repo: target.repo,
      comment_id: existing.id,
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
