import { git } from "./gh";

export function parseRepoFromRemote(remoteUrl: string): string | null {
  // https://github.com/owner/repo.git OR git@github.com:owner/repo.git
  const m = remoteUrl.match(/github\.com[:/]+([^/]+)\/([^/.]+)(\.git)?$/);
  if (!m) return null;
  return `${m[1]}/${m[2]}`;
}

export async function detectRepoFromCwd(): Promise<string | null> {
  const inside = await git(["rev-parse", "--is-inside-work-tree"]);
  if (inside.code !== 0) return null;

  const origin = await git(["remote", "get-url", "origin"]);
  if (origin.code !== 0) return null;

  const url = origin.stdout.trim();
  if (!url) return null;

  return parseRepoFromRemote(url);
}

export function splitRepo(repo: string): { owner: string; name: string } {
  const parts = repo.split("/", 2);
  if (parts.length !== 2) throw new Error(`Repo inválido: ${repo}`);
  return { owner: parts[0], name: parts[1] };
}

export function extractPrNumber(input: string): number | null {
  const s = input.trim();
  if (/^\d+$/.test(s)) return Number(s);
  const m = s.match(/\/pull\/(\d+)/);
  if (m) return Number(m[1]);
  return null;
}
