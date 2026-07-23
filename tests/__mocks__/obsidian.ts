// Minimaler Obsidian-Mock (Skill `obsidian-plugin-test-pattern`). Bewusst klein:
// neue Stubs erst dann ergaenzen, wenn ein Test sie braucht (lazy-add-on-demand).
import { vi } from "vitest";

export function makeFakeEl(): any {
  const children: any[] = [];
  const el: any = {
    children,
    className: "",
    textContent: "",
    style: {},
    dataset: {},
    createDiv: (opts?: any) => {
      const child = makeFakeEl();
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
      children.push(child);
      child.tagName = tag.toUpperCase();
      if (opts?.text) child.textContent = opts.text;
      if (opts?.cls) child.className = opts.cls;
      return child;
    },
    createSpan: (opts?: any) => el.createEl("span", opts),
    empty: () => {
      children.length = 0;
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
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    appendChild: (child: any) => {
      children.push(child);
    },
    detach: () => {
      children.length = 0;
    },
  };
  return el;
}

export class TFile {
  path = "";
  name = "";
  basename = "";
  extension = "";
  stat = { mtime: 0, ctime: 0, size: 0 };
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

export class Setting {
  constructor(public containerEl: any) {}
  setName(_n: string) {
    return this;
  }
  setDesc(_d: string) {
    return this;
  }
  setHeading() {
    return this;
  }
  addToggle(cb: any) {
    cb({ setValue: () => ({ onChange: () => {} }) });
    return this;
  }
  addText(cb: any) {
    cb({ setValue: () => ({ onChange: () => {} }), setPlaceholder: () => ({}) });
    return this;
  }
  addDropdown(cb: any) {
    cb({ addOption: () => ({}), setValue: () => ({ onChange: () => {} }) });
    return this;
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

export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

export function makeFakeApp(): any {
  return {
    vault: {
      readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
      getAbstractFileByPath: vi.fn().mockReturnValue(null),
      on: vi.fn().mockReturnValue({}),
      offref: vi.fn(),
    },
    workspace: {
      on: vi.fn().mockReturnValue({}),
      offref: vi.fn(),
    },
    metadataCache: {
      getFirstLinkpathDest: vi.fn().mockReturnValue(null),
    },
  };
}
