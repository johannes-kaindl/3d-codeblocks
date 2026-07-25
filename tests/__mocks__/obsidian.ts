// Minimaler Obsidian-Mock (Skill `obsidian-plugin-test-pattern`). Bewusst klein:
// neue Stubs erst dann ergaenzen, wenn ein Test sie braucht (lazy-add-on-demand).
import { vi } from "vitest";

export function makeFakeEl(): any {
  const children: any[] = [];
  const attrs: Record<string, string> = {};
  const handlers: Record<string, ((event?: any) => void)[]> = {};
  const el: any = {
    children,
    className: "",
    textContent: "",
    style: {},
    dataset: {},
    disabled: false,
    title: "",
    getAttribute: (name: string) => (name in attrs ? attrs[name] : null),
    setAttribute: (name: string, value: string) => {
      attrs[name] = value;
    },
    getAttr: (name: string) => (name in attrs ? attrs[name] : null),
    createDiv: (opts?: any) => {
      const child = makeFakeEl();
      setParent(child, el);
      children.push(child);
      if (typeof opts === "string") child.className = opts;
      else if (opts) {
        if (opts.cls) child.className = opts.cls;
        if (opts.text) child.textContent = opts.text;
      }
      return child;
    },
    createEl: (tag: string, opts?: any) => {
      const child = makeFakeEl();
      setParent(child, el);
      children.push(child);
      child.tagName = tag.toUpperCase();
      if (opts?.text) child.textContent = opts.text;
      if (opts?.cls) child.className = opts.cls;
      return child;
    },
    createSpan: (opts?: any) => el.createEl("span", opts),
    empty: () => {
      for (const child of children) setParent(child, null);
      children.length = 0;
      // Aufgezeichnete Setting-Zeilen (s. class Setting) gehoeren zum Inhalt —
      // sonst zaehlt ein Test nach dem Neuzeichnen die alten Zeilen mit.
      if (Array.isArray(el.settings)) el.settings.length = 0;
    },
    setText: (text: string) => {
      el.textContent = text;
    },
    addClass: (cls: string) => {
      el.className = `${el.className} ${cls}`.trim();
    },
    removeClass: (cls: string) => {
      el.className = el.className.replace(cls, "").trim();
    },
    toggleClass: (cls: string, on: boolean) => (on ? el.addClass(cls) : el.removeClass(cls)),
    // Registriert weiterhin ueber vi.fn (bestehende Tests lesen `.mock.calls`), fuehrt
    // den Handler aber auch wirklich aus — sonst bleibt `click()` unten wirkungslos.
    addEventListener: vi.fn((type: string, fn: (event?: any) => void) => {
      (handlers[type] ??= []).push(fn);
    }),
    removeEventListener: vi.fn(),
    appendChild: (child: any) => {
      setParent(child, el);
      children.push(child);
    },
    detach: () => {
      for (const child of children) setParent(child, null);
      children.length = 0;
    },
    click: () => {
      for (const fn of handlers.click ?? []) fn({ stopPropagation: () => {} });
    },
    // Muss sich wirklich aus `parentEl.children` austragen — sonst kann kein Test
    // eine liegen gebliebene oder doppelte Toolbar erkennen (nur das `removed`-Flag
    // zu setzen liess eine "entfernte" Leiste im DOM-Baum der Eltern zurueck).
    remove: () => {
      el.removed = true;
      const parent = el.parentEl;
      if (parent) {
        const siblings = parent.children as any[];
        const idx = siblings.indexOf(el);
        if (idx !== -1) siblings.splice(idx, 1);
        setParent(el, null);
      }
    },
  };
  // Nicht-aufzaehlbar: `JSON.stringify(el.children)` (viele bestehende Tests) durchsucht
  // Text im Baum -- ein sichtbares `parentEl` machte den Baum zirkulaer und liess genau
  // diese Tests mit "Converting circular structure to JSON" abstuerzen.
  Object.defineProperty(el, "parentEl", { value: null, writable: true, enumerable: false });
  return el;
}

function setParent(el: any, parent: any): void {
  el.parentEl = parent;
}

export class TFile {
  path = "";
  name = "";
  basename = "";
  extension = "";
  stat = { mtime: 0, ctime: 0, size: 0 };
  // `vault`/`parent` gehoeren zu TAbstractFile. Sie werden nie benutzt, muessen aber
  // da sein: `typecheck:test` prueft gegen die ECHTEN obsidian-Typen (der Mock-Alias
  // gilt nur zur Laufzeit, nie in der tsconfig — PROF-OBS-08).
  vault: any = {};
  parent: any = null;
}

export class Notice {
  constructor(
    public message: string,
    public timeout?: number,
  ) {}
}

export class Plugin {
  app: any;
  manifest: any;
  constructor(app: any, manifest: any) {
    this.app = app;
    this.manifest = manifest;
  }
  loadData(): Promise<any> {
    return Promise.resolve({});
  }
  saveData(_data: any): Promise<void> {
    return Promise.resolve();
  }
  addSettingTab(_tab: any) {}
  registerMarkdownCodeBlockProcessor(_lang: string, _handler: any) {}
  registerEvent(_ref: any) {}
  register(_cb: any) {}
}

export class PluginSettingTab {
  containerEl = makeFakeEl();
  constructor(
    public app: any,
    public plugin: any,
  ) {}
  display() {}
}

// Zeichnet auf, was gezeichnet wurde: Name/Desc und pro Widget Typ, gesetzter Wert,
// Optionen/Limits und der onChange-Handler. Dadurch ist der imperative Fallback-Pfad
// (Obsidian < 1.13) testbar, ohne echtes DOM — inklusive "was passiert beim Aendern".
// Jede Instanz haengt sich in `containerEl.settings`, damit ein Test die gezeichnete
// Liste in Reihenfolge lesen kann.
export class Setting {
  name = "";
  desc = "";
  heading = false;
  widgets: any[] = [];
  settingEl = makeFakeEl();

  constructor(public containerEl: any) {
    (containerEl.settings ??= []).push(this);
  }

  setName(n: string) {
    this.name = n;
    return this;
  }
  setDesc(d: string) {
    this.desc = d;
    return this;
  }
  setHeading() {
    this.heading = true;
    return this;
  }

  private widget(type: string, extra: Record<string, any> = {}) {
    const w: any = {
      type,
      value: undefined as unknown,
      onChangeHandler: undefined as ((v: any) => void) | undefined,
      ...extra,
      setValue(v: unknown) {
        w.value = v;
        return w;
      },
      setPlaceholder(p: string) {
        w.placeholder = p;
        return w;
      },
      setLimits(min: number, max: number, step: number) {
        Object.assign(w, { min, max, step });
        return w;
      },
      addOption(key: string, label: string) {
        w.options[key] = label;
        return w;
      },
      onChange(fn: (v: any) => void) {
        w.onChangeHandler = fn;
        return w;
      },
    };
    this.widgets.push(w);
    return w;
  }

  addToggle(cb: any) {
    cb(this.widget("toggle"));
    return this;
  }
  addText(cb: any) {
    cb(this.widget("text"));
    return this;
  }
  addDropdown(cb: any) {
    cb(this.widget("dropdown", { options: {} as Record<string, string> }));
    return this;
  }
  addSlider(cb: any) {
    cb(this.widget("slider"));
    return this;
  }
}

export class MarkdownView {
  file: TFile | null = null;
  editor: any = {};
  leaf: any;
  constructor(leaf?: any) {
    this.leaf = leaf;
  }
}

export class MarkdownRenderChild {
  containerEl: any;
  constructor(containerEl: any) {
    this.containerEl = containerEl;
  }
  onload() {}
  onunload() {}
  register(_cb: any) {}
  registerEvent(_ref: any) {}
}

export class FileView {
  app: any;
  contentEl: any = makeFakeEl();
  file: any = null;
  constructor(public leaf: any) {
    this.app = leaf?.app ?? makeFakeApp();
  }
  getViewType(): string {
    return "unknown";
  }
  getDisplayText(): string {
    return "";
  }
  onLoadFile(_file: any): Promise<void> {
    return Promise.resolve();
  }
  onUnloadFile(_file: any): Promise<void> {
    return Promise.resolve();
  }
  register(_cb: any) {}
}

export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

export class ItemView {
  containerEl: any = makeFakeEl();
  contentEl: any = makeFakeEl();
  constructor(public leaf: any) {}
  register(): void {}
  registerEvent(): void {}
  onload(): void {}
  onunload(): void {}
}

export function setIcon(el: any, name: string): void {
  el.dataset = el.dataset ?? {};
  el.dataset.icon = name;
}

export function makeFakeApp(): any {
  return {
    vault: {
      readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
      getAbstractFileByPath: vi.fn().mockReturnValue(null),
      read: vi.fn().mockResolvedValue(""),
      process: vi.fn().mockResolvedValue(""),
      on: vi.fn().mockReturnValue({}),
      offref: vi.fn(),
    },
    workspace: {
      on: vi.fn().mockReturnValue({}),
      offref: vi.fn(),
      getLeavesOfType: vi.fn().mockReturnValue([]),
    },
    metadataCache: {
      getFirstLinkpathDest: vi.fn().mockReturnValue(null),
    },
  };
}
