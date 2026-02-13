import { spawn } from "child_process";

export type RunResult = { code: number; stdout: string; stderr: string };

export async function run(
  cmd: string,
  args: string[],
  opts?: { cwd?: string; input?: string }
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, {
      cwd: opts?.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    p.stdout.on("data", (d) => (stdout += d.toString("utf8")));
    p.stderr.on("data", (d) => (stderr += d.toString("utf8")));
    p.on("error", reject);

    if (opts?.input !== undefined) {
      p.stdin.write(opts.input);
    }
    p.stdin.end();

    p.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

export async function gh(args: string[], opts?: { cwd?: string; input?: string }) {
  return run("gh", args, opts);
}

export async function git(args: string[], opts?: { cwd?: string; input?: string }) {
  return run("git", args, opts);
}

export async function mustOk(res: RunResult, context: string) {
  if (res.code !== 0) {
    const msg = res.stderr?.trim() || res.stdout?.trim() || `Exit ${res.code}`;
    throw new Error(`${context}: ${msg}`);
  }
  return res;
}
