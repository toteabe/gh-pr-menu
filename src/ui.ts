import * as blessed from "blessed";

export type PromptSelectItem = { label: string; value: string };

export class UI {
  screen: blessed.Widgets.Screen;
  menu: blessed.Widgets.ListElement;
  content: blessed.Widgets.BoxElement;
  status: blessed.Widgets.BoxElement;

  menuFullLabels: string[] = [];


  constructor() {
    this.screen = blessed.screen({
      smartCSR: true,
      title: "gh-pr-menu (TUI)",
    });

    this.menu = blessed.list({
      parent: this.screen,
      top: 0,
      left: 0,
      width: "32%",
      height: "100%-1",
      border: "line",
      label: " Menú ",
      keys: true,
      mouse: true,
      vi: true,
      style: { selected: { inverse: true } },
      scrollbar: { ch: " ", track: { bg: "grey" }, style: { inverse: true } },
    });

    this.content = blessed.box({
      parent: this.screen,
      top: 0,
      left: "32%",
      width: "68%",
      height: "100%-1",
      border: "line",
      label: " Salida ",
      tags: false,
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      mouse: true,
      vi: true,
      scrollbar: { ch: " ", track: { bg: "grey" }, style: { inverse: true } },
    });

    this.status = blessed.box({
      parent: this.screen,
      bottom: 0,
      left: 0,
      width: "100%",
      height: 1,
      style: { fg: "black", bg: "white" },
      content: " q: salir | Tab: cambiar foco | Enter: ejecutar | ↑↓ navegar ",
    });

    this.screen.key(["q", "C-c"], () => process.exit(0));
    this.screen.key(["tab"], () => {
      if (this.screen.focused === this.menu) this.content.focus();
      else this.menu.focus();
      this.screen.render();
    });

    this.menu.focus();
    this.screen.render();
  }

  setStatus(text: string) {
    this.status.setContent(" " + text + " ");
    this.screen.render();
  }

  show(text: string) {
    this.content.setContent(text);
    this.content.setScroll(0);
    this.screen.render();
  }

  append(text: string) {
    const cur = this.content.getContent() ?? "";
    this.content.setContent(cur + (cur.endsWith("\n") ? "" : "\n") + text);
    this.content.setScrollPerc(100);
    this.screen.render();
  }

  truncate(label: string, max: number) {
    if (max <= 0) return "";
    if (label.length <= max) return label;
    return max <= 1 ? "…" : label.slice(0, max - 1) + "…";
  }

  async promptInput(opts: {
    title: string;
    label: string;
    secret?: boolean;
    initial?: string;
  }): Promise<string | null> {
    return new Promise((resolve) => {
      const box = blessed.box({
        parent: this.screen,
        top: "center",
        left: "center",
        width: "70%",
        height: 7,
        border: "line",
        label: ` ${opts.title} `,
      });

      blessed.text({ parent: box, top: 1, left: 2, content: opts.label });

      const input = blessed.textbox({
        parent: box,
        top: 2,
        left: 2,
        width: "95%-2",
        height: 3,
        inputOnFocus: true,
        keys: true,
        mouse: true,
        vi: false,
        secret: !!opts.secret,
        censor: opts.secret ? true : undefined,
        value: opts.initial ?? "",
        border: "line",
      });

      blessed.text({ parent: box, bottom: 0, left: 2, content: "Enter: aceptar | Esc: cancelar" });

      const cleanup = (v: string | null) => {
        input.detach();
        box.detach();
        this.screen.render();
        resolve(v);
      };

      input.key(["escape"], () => cleanup(null));
      input.on("submit", (v) => cleanup(String(v ?? "")));

      input.focus();
      input.readInput(); 
      this.screen.render();
    });
  }

  async promptSelect(opts: {
    title: string;
    items: PromptSelectItem[];
    help?: string;
  }): Promise<PromptSelectItem | null> {
    return new Promise((resolve) => {
      const box = blessed.box({
        parent: this.screen,
        top: "center",
        left: "center",
        width: "80%",
        height: "70%",
        border: "line",
        label: ` ${opts.title} `,
      });

      if (opts.help) blessed.text({ parent: box, top: 0, left: 2, content: opts.help });

      const list = blessed.list({
        parent: box,
        top: 1,
        left: 1,
        width: "100%-2",
        height: "100%-3",
        border: "line",
        keys: true,
        mouse: true,
        vi: true,
        style: { selected: { inverse: true } },
        items: opts.items.map((i) => i.label),
        scrollbar: { ch: " ", track: { bg: "grey" }, style: { inverse: true } },
      });

      blessed.text({ parent: box, bottom: 0, left: 2, content: "Enter: elegir | Esc: cancelar" });

      const cleanup = (v: PromptSelectItem | null) => {
        list.detach();
        box.detach();
        this.screen.render();
        resolve(v);
      };

      list.key(["escape"], () => cleanup(null));
      list.on("select", (_el, idx) => cleanup(opts.items[idx]));

      list.focus();
      this.screen.render();
    });
  }

  async promptTextarea(opts: { title: string; help?: string }): Promise<string | null> {
    return new Promise((resolve) => {
      const box = blessed.box({
        parent: this.screen,
        top: "center",
        left: "center",
        width: "85%",
        height: "80%",
        border: "line",
        label: ` ${opts.title} `,
      });

      if (opts.help) blessed.text({ parent: box, top: 0, left: 2, content: opts.help });

      const area = blessed.textarea({
        parent: box,
        top: 1,
        left: 1,
        width: "100%-2",
        height: "100%-3",
        border: "line",
        inputOnFocus: true,
        keys: true,
        mouse: true,
        vi: false,
        scrollbar: { ch: " ", track: { bg: "grey" }, style: { inverse: true } },
      });

      blessed.text({ parent: box, bottom: 0, left: 2, content: "Ctrl+S: enviar | Esc: cancelar" });

      const cleanup = (v: string | null) => {
        area.detach();
        box.detach();
        this.screen.render();
        resolve(v);
      };

      area.key(["escape"], () => cleanup(null));
      area.key(["C-s"], () => cleanup(area.getValue()));

      area.focus();
      area.readInput();
      this.screen.render();
    });
  }
}
