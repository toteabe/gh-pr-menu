import { UI } from "./ui";
import { gh, git, mustOk } from "./gh";
import { detectRepoFromCwd, extractPrNumber, splitRepo } from "./repo";
import * as github from "./github";
import * as diff from "./diff";

function openUrl(url: string) {
  const platform = process.platform;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { spawn } = require("child_process");
  if (platform === "win32") spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", windowsHide: true });
  else if (platform === "darwin") spawn("open", [url], { stdio: "ignore" });
  else spawn("xdg-open", [url], { stdio: "ignore" });
}

async function ensureDeps() {
  await mustOk(await gh(["--version"]), "gh --version");
  await mustOk(await git(["--version"]), "git --version");
}

async function getRepo(ui: UI): Promise<string> {
  const detected = await detectRepoFromCwd();
  if (detected) return detected;

  const repo = await ui.promptInput({ title: "Repo", label: "Introduce owner/repo:" });
  if (!repo) throw new Error("Cancelado.");
  if (!/^[^/]+\/[^/]+$/.test(repo.trim())) throw new Error("Formato inválido (owner/repo).");
  return repo.trim();
}

async function getPrNumber(ui: UI): Promise<number> {
  const input = await ui.promptInput({ title: "Pull Request", label: "Número de PR (42) o URL (.../pull/42):" });
  if (!input) throw new Error("Cancelado.");
  const n = extractPrNumber(input);
  if (!n) throw new Error("No pude extraer número de PR.");
  return n;
}

function formatPullLine(p: github.Pull): string {
  const state = p.merged_at ? "merged" : p.state;
  const draft = p.draft ? " (draft)" : "";
  return `#${p.number} [${state}]${draft} ${p.title} (@${p.user.login})`;
}

function formatPullDetails(p: github.Pull): string {
  const state = p.merged_at ? "merged" : p.state;
  const draft = p.draft ? " (draft)" : "";
  const labels = p.labels?.length ? p.labels.map((l) => l.name).join(", ") : "-";
  const assignees = p.assignees?.length ? p.assignees.map((a) => a.login).join(", ") : "-";
  const milestone = p.milestone ? `Milestone: ${p.milestone.title}\n` : "";
  const body = p.body ?? "";

  return [
    `#${p.number} ${p.title}`,
    `State: ${state}${draft}`,
    `Author: @${p.user.login}`,
    `Base: ${p.base.ref}   Head: ${p.head.ref}`,
    `Created: ${p.created_at}   Updated: ${p.updated_at}`,
    `URL: ${p.html_url}`,
    "",
    `Stats: ${p.commits} commits • ${p.changed_files} files • +${p.additions} -${p.deletions}`,
    `Labels: ${labels}`,
    `Assignees: ${assignees}`,
    milestone.trimEnd(),
    "",
    "Body:",
    body,
  ]
    .filter(Boolean)
    .join("\n");
}

async function actionAuthStatus(ui: UI) {
  const s = await github.authStatus();
  ui.show(s.output || (s.ok ? "OK" : "No auth"));
}

async function actionLogin(ui: UI) {
  const token = await ui.promptInput({ title: "Login", label: "Pega tu token (PAT):", secret: true });
  if (!token) return;
  await github.authLoginWithToken(token);
  ui.show("✅ Autenticación completada.");
}

async function actionList(ui: UI, state: github.PullState, onlyMine: boolean) {
  const repo = await getRepo(ui);
  ui.setStatus("Cargando PRs...");
  const pulls = await github.listPulls(repo, state, 30);

  let shown = pulls;
  if (onlyMine) {
    const me = await github.getUserLogin();
    shown = pulls.filter((p) => p.user.login.toLowerCase() === me.toLowerCase());
  }

  ui.show(
    [
      `Repo: ${repo}`,
      `Estado: ${state}${onlyMine ? " (solo míos)" : ""}`,
      "----------------------------------------",
      ...(shown.length ? shown.map(formatPullLine) : ["(sin resultados)"]),
    ].join("\n")
  );
  ui.setStatus("Listo.");
}

async function actionViewPr(ui: UI) {
  const repo = await getRepo(ui);
  const pr = await getPrNumber(ui);
  ui.setStatus("Cargando PR...");
  const p = await github.getPull(repo, pr);
  ui.show(formatPullDetails(p));
  ui.setStatus("Listo.");
}

async function actionOpenWeb(ui: UI) {
  const repo = await getRepo(ui);
  const pr = await getPrNumber(ui);
  const { owner, name } = splitRepo(repo);
  const url = `https://github.com/${owner}/${name}/pull/${pr}`;
  ui.show(url);
  openUrl(url);
}

async function actionCheckout(ui: UI) {
  const repo = await getRepo(ui);
  const pr = await getPrNumber(ui);
  ui.setStatus("Checkout...");
  const res = await gh(["pr", "checkout", "-R", repo, String(pr)]);
  if (res.code !== 0) throw new Error(res.stderr || res.stdout);
  ui.show(res.stdout || "✅ Checkout completado.");
  ui.setStatus("Listo.");
}

async function actionCreatePr(ui: UI) {
  const repo = await getRepo(ui);

  ui.setStatus("Detectando rama actual...");
  const br = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (br.code !== 0) throw new Error("No estoy en un repo git o no puedo detectar la rama.");
  const head = br.stdout.trim();

  let base = "main";
  try {
    const r = await gh(["repo", "view", repo, "--json", "defaultBranchRef", "-q", ".defaultBranchRef.name"]);
    if (r.code === 0 && r.stdout.trim()) base = r.stdout.trim();
  } catch {}

  const baseIn = await ui.promptInput({ title: "Crear PR", label: `Base branch [${base}]:`, initial: base });
  if (!baseIn) return;
  base = baseIn.trim() || base;

  const title = await ui.promptInput({ title: "Crear PR", label: "Título:" });
  if (!title) return;

  const draftSel = await ui.promptSelect({
    title: "Crear PR",
    items: [
      { label: "No draft", value: "no" },
      { label: "Draft", value: "yes" },
    ],
    help: "¿PR en modo draft?",
  });
  if (!draftSel) return;
  const draftMode = draftSel.value === "yes";

  const body = await ui.promptTextarea({ title: "Cuerpo del PR", help: "Ctrl+S para crear" });
  if (body === null) return;

  ui.setStatus("Push a origin...");
  const up = await git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  if (up.code !== 0) await mustOk(await git(["push", "-u", "origin", head]), "git push -u");
  else await mustOk(await git(["push"]), "git push");

  ui.setStatus("Creando PR (REST)...");
  try {
    const url = await github.createPull(repo, { title: title.trim(), head, base, body, draft: draftMode });
    ui.show(`✅ PR creado:\n${url}`);
  } catch (e: any) {
    ui.append("\n(REST falló, intento con `gh pr create`...)\n");
    const res2 = await gh([
      "pr",
      "create",
      "-R",
      repo,
      "--base",
      base,
      "--head",
      head,
      "--title",
      title.trim(),
      "--body",
      body,
      ...(draftMode ? ["--draft"] : []),
    ]);
    if (res2.code !== 0) throw new Error(res2.stderr || res2.stdout);
    ui.show(res2.stdout);
  } finally {
    ui.setStatus("Listo.");
  }
}

async function actionMerge(ui: UI) {
  const repo = await getRepo(ui);
  const pr = await getPrNumber(ui);

  const methodPick = await ui.promptSelect({
    title: "Merge PR",
    items: [
      { label: "merge (commit merge)", value: "merge" },
      { label: "squash", value: "squash" },
      { label: "rebase", value: "rebase" },
    ],
  });
  if (!methodPick) return;

  const delPick = await ui.promptSelect({
    title: "Merge PR",
    items: [
      { label: "No borrar rama", value: "no" },
      { label: "Borrar rama después", value: "yes" },
    ],
  });
  if (!delPick) return;

  ui.setStatus("Mergeando...");
  const m = await github.mergePull(repo, pr, methodPick.value as any);
  if (!m.merged) {
    ui.show(`❌ No se pudo mergear: ${m.message}`);
    ui.setStatus("Listo.");
    return;
  }

  let msg = `✅ Merge OK: ${m.message}`;
  if (delPick.value === "yes") {
    const p = await github.getPull(repo, pr);
    const del = await github.deleteBranchIfPossible(repo, p.head.repo.full_name, p.head.repo.owner.login, p.head.ref);
    msg += del.deleted ? `\n✅ Rama borrada: ${p.head.ref}` : `\n⚠️ Rama no borrada: ${del.reason ?? "sin razón"}`;
  }

  ui.show(msg);
  ui.setStatus("Listo.");
}

async function actionComments(ui: UI) {
  const repo = await getRepo(ui);
  const pr = await getPrNumber(ui);

  ui.setStatus("Cargando comentarios...");
  const issue = await github.listIssueComments(repo, pr);
  const review = await github.listReviewComments(repo, pr);

  const lines: string[] = [];
  lines.push(`Comentarios del PR #${pr} en ${repo}`);
  lines.push("============================================================");
  lines.push("");
  lines.push("### Issue comments (conversación) ###");
  lines.push("");
  if (!issue.length) lines.push("(sin comentarios)");
  for (const c of issue) {
    lines.push(`— @${c.user.login} • ${c.created_at}`);
    lines.push(c.html_url);
    lines.push(c.body ?? "");
    lines.push("");
  }

  lines.push("");
  lines.push("### Review comments (inline) ###");
  lines.push("");
  if (!review.length) lines.push("(sin comentarios de review)");
  for (const c of review) {
    const line = c.line ?? c.original_line ?? 0;
    lines.push(`— @${c.user.login} • ${c.created_at}`);
    lines.push(c.html_url);
    lines.push(`File: ${c.path}  Line: ${line}`);
    lines.push(c.body ?? "");
    lines.push("");
  }

  ui.show(lines.join("\n"));
  ui.setStatus("Listo.");
}

async function actionAddComment(ui: UI) {
  const repo = await getRepo(ui);
  const pr = await getPrNumber(ui);

  const body = await ui.promptTextarea({ title: "Añadir comentario", help: "Ctrl+S: enviar | Esc: cancelar" });
  if (body === null) return;
  if (!body.trim()) throw new Error("Comentario vacío.");

  ui.setStatus("Publicando comentario...");
  const url = await github.addIssueComment(repo, pr, body);
  ui.show(`✅ Comentario añadido:\n${url}`);
  ui.setStatus("Listo.");
}

async function actionInlineCommentGuided(ui: UI) {
  const repo = await getRepo(ui);
  const pr = await getPrNumber(ui);

  ui.setStatus("Cargando PR...");
  const p = await github.getPull(repo, pr);

  ui.setStatus("Listando ficheros...");
  const files = await github.listPullFiles(repo, pr);
  if (!files.length) throw new Error("No hay ficheros en el PR.");

  const filePick = await ui.promptSelect({
    title: "Selecciona fichero",
    items: files.slice(0, 200).map((f) => ({ label: f.filename, value: f.filename })),
    help: "Ficheros cambiados",
  });
  if (!filePick) return;
  const path = filePick.value;

  const file = files.find((f) => f.filename === path);
  let diffLines: string[] = [];
  if (file?.patch) {
    diffLines = [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, ...file.patch.split(/\r?\n/)];
  } else {
    ui.setStatus("Patch vacío, cargando diff completo...");
    const full = await github.getPullDiff(repo, pr);
    diffLines = diff.extractFileDiffFromFullDiff(full, path);
    if (!diffLines.length) throw new Error("No pude extraer el diff del fichero (binario o sin patch).");
  }

  const hunks = diff.parseHunks(diffLines);
  if (!hunks.length) throw new Error("No detecté hunks (@@). ¿Fichero binario?");

  const hunkPick = await ui.promptSelect({
    title: "Selecciona hunk",
    items: [
      { label: "Todos los hunks", value: "0" },
      ...hunks.map((h) => ({
        label: `${h.index}) LEFT ${h.leftFrom}..${h.leftTo}  RIGHT ${h.rightFrom}..${h.rightTo}  ${h.header}`,
        value: String(h.index),
      })),
    ],
    help: "Elige hunk o todos",
  });
  if (!hunkPick) return;
  const wantHunk = Number(hunkPick.value);

  const { annotated, valid } = diff.annotateDiff(diffLines, wantHunk);
  ui.show(annotated.join("\n"));

  while (true) {
    const sub = await ui.promptSelect({
      title: "Diff",
      items: [
        { label: "Ver diff anotado", value: "view" },
        { label: "Buscar texto", value: "search" },
        { label: "Continuar (elegir línea)", value: "go" },
      ],
      help: "Opciones",
    });
    if (!sub) return;
    if (sub.value === "view") {
      ui.show(annotated.join("\n"));
      continue;
    }
    if (sub.value === "search") {
      const q = await ui.promptInput({ title: "Buscar", label: "Texto a buscar:" });
      if (!q) continue;
      const matches = diff.searchAnnotated(annotated, q, 50);
      if (!matches.length) {
        ui.show(`(sin coincidencias para "${q}")\n\n` + annotated.slice(0, 200).join("\n"));
        continue;
      }
      const mPick = await ui.promptSelect({
        title: "Coincidencias",
        items: matches.map((m) => ({ label: `[${m.lineNo}] ${m.text}`, value: String(m.lineNo) })),
        help: "Selecciona una para ver contexto",
      });
      if (!mPick) continue;
      const lineNo = Number(mPick.value);
      ui.show(diff.contextAround(annotated, lineNo, 25).join("\n"));
      continue;
    }
    break;
  }

  let side: "LEFT" | "RIGHT" | null = null;
  let line: number | null = null;
  for (let i = 0; i < 5; i++) {
    const sel = await ui.promptInput({ title: "Línea", label: "Elige línea (R123 / L88 / 123=RIGHT):" });
    if (!sel) return;
    const parsed = diff.parseLineSelector(sel);
    if (!parsed) {
      ui.show("Formato inválido. Usa R123 o L88 o 123.");
      continue;
    }
    if (!diff.isValidLine(valid, parsed.side, parsed.line)) {
      ui.show("Esa línea no es válida en el diff. Elige otra.");
      continue;
    }
    side = parsed.side;
    line = parsed.line;
    break;
  }
  if (!side || !line) throw new Error("No se seleccionó una línea válida.");

  const body = await ui.promptTextarea({ title: "Comentario inline", help: "Ctrl+S: enviar" });
  if (body === null) return;
  if (!body.trim()) throw new Error("Comentario vacío.");

  ui.setStatus("Publicando inline comment...");
  const url = await github.addInlineReviewComment(repo, pr, { body, commit_id: p.head.sha, path, line, side });

  ui.show(`✅ Comentario inline añadido:\n${url}`);
  ui.setStatus("Listo.");
}

async function actionClose(ui: UI) {
  const repo = await getRepo(ui);
  const pr = await getPrNumber(ui);

  const delPick = await ui.promptSelect({
    title: "Cerrar PR",
    items: [
      { label: "Cerrar (sin borrar rama)", value: "no" },
      { label: "Cerrar y borrar rama (si es posible)", value: "yes" },
    ],
  });
  if (!delPick) return;

  const comment = await ui.promptTextarea({
    title: "Comentario al cerrar (opcional)",
    help: "Deja vacío si no quieres comentar. Ctrl+S para continuar.",
  });
  if (comment === null) return;

  ui.setStatus("Cerrando PR...");
  if (comment.trim()) await github.addIssueComment(repo, pr, comment);
  await github.closePull(repo, pr);

  let msg = "✅ PR cerrado.";
  if (delPick.value === "yes") {
    const p = await github.getPull(repo, pr);
    const del = await github.deleteBranchIfPossible(repo, p.head.repo.full_name, p.head.repo.owner.login, p.head.ref);
    msg += del.deleted ? `\n✅ Rama borrada: ${p.head.ref}` : `\n⚠️ Rama no borrada: ${del.reason ?? "sin razón"}`;
  }

  ui.show(msg);
  ui.setStatus("Listo.");
}

async function main() {
  const ui = new UI();
  await ensureDeps();

  const items = [
    { label: "1) Estado de autenticación", run: () => actionAuthStatus(ui) },
    { label: "2) Login con token (PAT)", run: () => actionLogin(ui) },
    { label: "3) Listar PRs (open)", run: () => actionList(ui, "open", false) },
    { label: "4) Listar mis PRs (open)", run: () => actionList(ui, "open", true) },
    {
      label: "5) Listar PRs por estado (open/closed/merged)",
      run: async () => {
        const pick = await ui.promptSelect({
          title: "Estado",
          items: [
            { label: "open", value: "open" },
            { label: "closed", value: "closed" },
            { label: "merged", value: "merged" },
          ],
        });
        if (!pick) return;
        return actionList(ui, pick.value as any, false);
      },
    },
    { label: "6) Ver detalle PR (REST)", run: () => actionViewPr(ui) },
    { label: "7) Abrir PR en navegador", run: () => actionOpenWeb(ui) },
    { label: "8) Checkout PR", run: () => actionCheckout(ui) },
    { label: "9) Crear PR desde rama actual", run: () => actionCreatePr(ui) },
    { label: "10) Merge PR (REST)", run: () => actionMerge(ui) },
    { label: "11) Ver comentarios PR", run: () => actionComments(ui) },
    { label: "12) Añadir comentario (conversación)", run: () => actionAddComment(ui) },
    { label: "13) Añadir comentario inline (guiado + búsqueda)", run: () => actionInlineCommentGuided(ui) },
    { label: "14) Cerrar PR + (opcional) borrar rama", run: () => actionClose(ui) },
    { label: "0) Salir", run: async () => process.exit(0) },
  ] as const;

  //ui.menu.setItems(items.map((i) => i.label));

  ui.menuFullLabels = items.map(i => i.label);

// OJO: ancho útil (número) una vez renderizado suele estar en this.menu.width
  const w = typeof ui.menu.width === "number" ? ui.menu.width : 30; // fallback
  const usable = Math.max(10, w - 2 - 1); // border(2) + scrollbar(1)

  ui.menu.setItems(ui.menuFullLabels.map(t => ui.truncate(t, usable)));

  ui.menu.on("highlight", (_el, idx) => {
    const full = ui.menuFullLabels[idx] ?? "";
    ui.setStatus(full);
  });

  ui.menu.on("select", async (_el, idx) => {
    try {
      ui.setStatus("Ejecutando...");
      await items[idx].run();
    } catch (e: any) {
      ui.show(`❌ Error:\n${e?.message ?? String(e)}`);
    } finally {
      ui.setStatus("Listo. q: salir | Tab: foco | Enter: ejecutar | ↑↓ navegar");
    }
  });

  ui.screen.render();
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
