import blessed from "blessed";

export async function promptCommentWithEditor(
  screen: blessed.Widgets.Screen,
  title: string,
  initial = ""
): Promise<string | null> {
  return await new Promise((resolve) => {
    const help = blessed.box({
      parent: screen,
      top: "center",
      left: "center",
      width: "80%",
      height: 7,
      border: "line",
      label: ` ${title} `,
      padding: { left: 1, right: 1, top: 1, bottom: 1 },
      content:
        "Se abrirá tu editor (por defecto: nano).\n" +
        "Guarda y cierra para volver a la TUI.\n\n" +
        "Tip: export EDITOR=nano   (o el que quieras)",
    });

    screen.render();

    // ✅ Por defecto nano si EDITOR no está definido
    const editor = (process.env.EDITOR && process.env.EDITOR.trim()) ? process.env.EDITOR.trim() : "nano";

    (screen as any).readEditor(
      { value: initial, editor, name: "gh-pr-tui" },
      (err: any, data: Buffer | string) => {
        help.destroy();
        screen.render();

        if (err) return resolve(null);

        const value = Buffer.isBuffer(data) ? data.toString("utf8") : String(data ?? "");
        resolve(value.replace(/\s+$/g, ""));
      }
    );
  });
}
