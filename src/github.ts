import { gh, mustOk } from "./gh";
import { splitRepo } from "./repo";

export type PullState = "open" | "closed" | "merged";

export type Pull = {
  number: number;
  title: string;
  state: "open" | "closed";
  draft: boolean;
  merged_at: string | null;
  user: { login: string };
  base: { ref: string };
  head: {
    ref: string;
    sha: string;
    repo: { full_name: string; owner: { login: string } };
  };
  html_url: string;
  created_at: string;
  updated_at: string;
  commits: number;
  changed_files: number;
  additions: number;
  deletions: number;
  labels: { name: string }[];
  assignees: { login: string }[];
  milestone: null | { title: string };
  body: string | null;
};

export type PullFile = { filename: string; patch?: string };

function buildFieldArgs(fields: Record<string, any>): string[] {
  const args: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "number" || typeof v === "boolean") {
      args.push("-f", `${k}=${v}`);
    } else {
      args.push("--raw-field", `${k}=${String(v)}`);
    }
  }
  return args;
}

async function apiJson<T>(
  endpoint: string,
  opts?: { method?: string; fields?: Record<string, any> }
): Promise<T> {
  const args: string[] = ["api", "-H", "Accept: application/vnd.github+json"];
  if (opts?.method) args.push("-X", opts.method);
  args.push(endpoint);
  if (opts?.fields) args.push(...buildFieldArgs(opts.fields));

  const res = await gh(args);
  await mustOk(res, "gh api");
  return JSON.parse(res.stdout) as T;
}

async function apiText(endpoint: string, accept: string): Promise<string> {
  const res = await gh(["api", "-H", `Accept: ${accept}`, endpoint]);
  await mustOk(res, "gh api (text)");
  return res.stdout;
}

export async function getUserLogin(): Promise<string> {
  const me = await apiJson<{ login: string }>("/user");
  return me.login;
}

export async function getPull(repo: string, pr: number): Promise<Pull> {
  const { owner, name } = splitRepo(repo);
  return apiJson<Pull>(`/repos/${owner}/${name}/pulls/${pr}`);
}

export async function listPulls(
  repo: string,
  state: PullState,
  limit = 30
): Promise<Pull[]> {
  const { owner, name } = splitRepo(repo);

  if (state === "merged") {
    const closed = await listPulls(repo, "closed", Math.max(limit, 50));
    return closed.filter((p) => p.merged_at !== null).slice(0, limit);
  }

  const perPage = Math.min(100, Math.max(1, limit));
  const pulls = await apiJson<Pull[]>(
    `/repos/${owner}/${name}/pulls?state=${state}&per_page=${perPage}&page=1`
  );
  return pulls.slice(0, limit);
}

export async function listPullFiles(repo: string, pr: number): Promise<PullFile[]> {
  const { owner, name } = splitRepo(repo);
  const all: PullFile[] = [];
  for (let page = 1; page <= 50; page++) {
    const batch = await apiJson<PullFile[]>(
      `/repos/${owner}/${name}/pulls/${pr}/files?per_page=100&page=${page}`
    );
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

export async function getPullDiff(repo: string, pr: number): Promise<string> {
  const { owner, name } = splitRepo(repo);
  return apiText(`/repos/${owner}/${name}/pulls/${pr}`, "application/vnd.github.v3.diff");
}

export async function listIssueComments(repo: string, pr: number): Promise<any[]> {
  const { owner, name } = splitRepo(repo);
  const all: any[] = [];
  for (let page = 1; page <= 50; page++) {
    const batch = await apiJson<any[]>(
      `/repos/${owner}/${name}/issues/${pr}/comments?per_page=100&page=${page}`
    );
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

export async function listReviewComments(repo: string, pr: number): Promise<any[]> {
  const { owner, name } = splitRepo(repo);
  const all: any[] = [];
  for (let page = 1; page <= 50; page++) {
    const batch = await apiJson<any[]>(
      `/repos/${owner}/${name}/pulls/${pr}/comments?per_page=100&page=${page}`
    );
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

export async function addIssueComment(repo: string, pr: number, body: string): Promise<string> {
  const { owner, name } = splitRepo(repo);
  const res = await apiJson<{ html_url: string }>(
    `/repos/${owner}/${name}/issues/${pr}/comments`,
    { method: "POST", fields: { body } }
  );
  return res.html_url;
}

export async function addInlineReviewComment(
  repo: string,
  pr: number,
  payload: { body: string; commit_id: string; path: string; line: number; side: "LEFT" | "RIGHT" }
): Promise<string> {
  const { owner, name } = splitRepo(repo);
  const res = await apiJson<{ html_url: string }>(
    `/repos/${owner}/${name}/pulls/${pr}/comments`,
    { method: "POST", fields: payload }
  );
  return res.html_url;
}

export async function createPull(
  repo: string,
  payload: { title: string; head: string; base: string; body: string; draft: boolean }
): Promise<string> {
  const { owner, name } = splitRepo(repo);
  const res = await apiJson<{ html_url: string }>(
    `/repos/${owner}/${name}/pulls`,
    { method: "POST", fields: payload }
  );
  return res.html_url;
}

export async function mergePull(
  repo: string,
  pr: number,
  method: "merge" | "squash" | "rebase"
): Promise<{ merged: boolean; message: string }> {
  const { owner, name } = splitRepo(repo);
  return apiJson<{ merged: boolean; message: string }>(
    `/repos/${owner}/${name}/pulls/${pr}/merge`,
    { method: "PUT", fields: { merge_method: method } }
  );
}

export async function closePull(repo: string, pr: number): Promise<void> {
  const { owner, name } = splitRepo(repo);
  await apiJson<any>(
    `/repos/${owner}/${name}/pulls/${pr}`,
    { method: "PATCH", fields: { state: "closed" } }
  );
}

export async function deleteBranchIfPossible(
  repo: string,
  headRepoFullName: string,
  headOwnerLogin: string,
  headRef: string
): Promise<{ deleted: boolean; reason?: string }> {
  if (headRepoFullName !== repo) {
    return { deleted: false, reason: "La rama está en un fork (no se borra desde aquí)." };
  }

  const { owner, name } = splitRepo(repo);
  if (owner !== headOwnerLogin) {
    return { deleted: false, reason: "Owner distinto (posible fork). No se borra." };
  }

  const encoded = encodeURIComponent(headRef);
  const endpoint = `/repos/${owner}/${name}/git/refs/heads/${encoded}`;

  try {
    const res = await gh(["api", "-X", "DELETE", "-H", "Accept: application/vnd.github+json", endpoint]);
    await mustOk(res, "Delete branch");
    return { deleted: true };
  } catch (e: any) {
    return { deleted: false, reason: e?.message ?? "Error borrando rama" };
  }
}

export async function authStatus(): Promise<{ ok: boolean; output: string }> {
  const res = await gh(["auth", "status", "-h", "github.com"]);
  if (res.code === 0) return { ok: true, output: res.stdout };
  return { ok: false, output: res.stderr || res.stdout };
}

export async function authLoginWithToken(token: string): Promise<void> {
  const res = await gh(["auth", "login", "--hostname", "github.com", "--with-token"], { input: token });
  await mustOk(res, "gh auth login");
}
