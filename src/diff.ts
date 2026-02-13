export type Hunk = {
  index: number;
  leftFrom: number;
  leftTo: number;
  rightFrom: number;
  rightTo: number;
  header: string;
  startLine: number;
};

export function parseHunks(lines: string[]): Hunk[] {
  const hunks: Hunk[] = [];
  let h = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (!m) continue;

    h++;
    const l0 = Number(m[1]);
    const lc = m[2] ? Number(m[2]) : 1;
    const r0 = Number(m[3]);
    const rc = m[4] ? Number(m[4]) : 1;

    hunks.push({
      index: h,
      leftFrom: l0,
      leftTo: l0 + lc - 1,
      rightFrom: r0,
      rightTo: r0 + rc - 1,
      header: line,
      startLine: i,
    });
  }
  return hunks;
}

export function annotateDiff(
  lines: string[],
  wantHunkIndex: number // 0 => all
): { annotated: string[]; valid: Set<string> } {
  const valid = new Set<string>();
  const annotated: string[] = [];

  let currentHunk = 0;
  let active = false;
  let l = 0;
  let r = 0;

  const emit = (ln: string, rn: string, txt: string) => {
    const L = ln.padEnd(6, " ");
    const R = rn.padEnd(6, " ");
    annotated.push(`L${L} R${R} | ${txt}`);
  };

  for (const line of lines) {
    const hm = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hm) {
      currentHunk++;
      active = wantHunkIndex === 0 || currentHunk === wantHunkIndex;
      l = Number(hm[1]);
      r = Number(hm[3]);
      if (active) emit("", "", line);
      continue;
    }

    if (/^(diff --git |index |--- |\+\+\+ )/.test(line)) {
      if (active) emit("", "", line);
      continue;
    }

    if (!active) continue;

    const c = line[0] ?? "";
    if (c === " ") {
      emit(String(l), String(r), line);
      valid.add(`L ${l}`);
      valid.add(`R ${r}`);
      l++;
      r++;
    } else if (c === "+") {
      emit("", String(r), line);
      valid.add(`R ${r}`);
      r++;
    } else if (c === "-") {
      emit(String(l), "", line);
      valid.add(`L ${l}`);
      l++;
    } else {
      emit("", "", line);
    }
  }

  return { annotated, valid };
}

export function parseLineSelector(
  sel: string
): { side: "LEFT" | "RIGHT"; line: number } | null {
  const s = sel.trim();
  let m = s.match(/^[Rr](\d+)$/);
  if (m) return { side: "RIGHT", line: Number(m[1]) };
  m = s.match(/^[Ll](\d+)$/);
  if (m) return { side: "LEFT", line: Number(m[1]) };
  if (/^\d+$/.test(s)) return { side: "RIGHT", line: Number(s) };
  return null;
}

export function isValidLine(
  valid: Set<string>,
  side: "LEFT" | "RIGHT",
  line: number
): boolean {
  const key = side === "LEFT" ? `L ${line}` : `R ${line}`;
  return valid.has(key);
}

export function searchAnnotated(annotated: string[], query: string, limit = 50) {
  const q = query.toLowerCase();
  const matches: { lineNo: number; text: string }[] = [];
  for (let i = 0; i < annotated.length; i++) {
    if (annotated[i].toLowerCase().includes(q)) {
      matches.push({ lineNo: i + 1, text: annotated[i] });
      if (matches.length >= limit) break;
    }
  }
  return matches;
}

export function contextAround(annotated: string[], lineNo: number, ctx = 25): string[] {
  const idx = lineNo - 1;
  const from = Math.max(0, idx - ctx);
  const to = Math.min(annotated.length - 1, idx + ctx);
  const out: string[] = [];
  for (let i = from; i <= to; i++) {
    out.push(`[${String(i + 1).padStart(5, " ")}] ${annotated[i]}`);
  }
  return out;
}

export function extractFileDiffFromFullDiff(fullDiff: string, path: string): string[] {
  const lines = fullDiff.split(/\r?\n/);
  const out: string[] = [];
  let inFile = false;

  const startsFile = (line: string) => {
    const m = line.match(/^diff --git a\/(.*) b\/(.*)$/);
    if (!m) return false;
    const a = m[1];
    const b = m[2];
    return a === path || b === path;
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      inFile = startsFile(line);
    }
    if (inFile) out.push(line);
  }
  return out;
}
