import { describe, expect, it, vi } from "vitest";
import { Notice } from "obsidian";
import type { ViewportController } from "../../src/core/active-viewport";
import { saveViewAsImage } from "../../src/obsidian/save-image";

// 1x1 PNG
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function setup(opts: { snapshot?: string | null; noSnapshot?: boolean; label?: string; throwOnCreate?: boolean } = {}) {
  const created: { path: string; bytes: ArrayBuffer }[] = [];
  const app = {
    workspace: { getActiveFile: () => ({ path: "Notes/Haus.md" }) },
    fileManager: { getAvailablePathForAttachment: vi.fn(async (name: string) => `Attachments/${name}`) },
    vault: {
      createBinary: vi.fn(async (path: string, bytes: ArrayBuffer) => {
        if (opts.throwOnCreate) throw new Error("disk full");
        created.push({ path, bytes });
      }),
    },
  };
  const controller = {
    label: () => opts.label ?? "Haus: Erdgeschoss/Plan",
    ...(opts.noSnapshot ? {} : { snapshot: () => (opts.snapshot === undefined ? PNG : opts.snapshot) }),
  } as unknown as ViewportController;
  return { app, controller, created };
}

const notices = () => (Notice as unknown as { instances?: string[] }).instances;

describe("saveViewAsImage", () => {
  it("schreibt die PNG-Bytes in den Attachment-Pfad, mit bereinigtem Namen", async () => {
    const { app, controller, created } = setup();
    await saveViewAsImage(app as never, controller);
    expect(created).toHaveLength(1);
    expect(created[0].path).toMatch(/^Attachments\/[^/]+\.png$/);
    expect(created[0].path).not.toMatch(/[:]/);
    const head = new Uint8Array(created[0].bytes).slice(0, 4);
    expect([...head]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(app.fileManager.getAvailablePathForAttachment).toHaveBeenCalledWith(expect.stringMatching(/\.png$/), "Notes/Haus.md");
  });
  it("ohne Frame (null) wird nichts geschrieben", async () => {
    const { app, controller, created } = setup({ snapshot: null });
    await saveViewAsImage(app as never, controller);
    expect(created).toEqual([]);
    expect(app.vault.createBinary).not.toHaveBeenCalled();
  });
  it("ein Weg ohne snapshot() schreibt nichts", async () => {
    const { app, controller } = setup({ noSnapshot: true });
    await saveViewAsImage(app as never, controller);
    expect(app.vault.createBinary).not.toHaveBeenCalled();
  });
  it("kein PNG (fremdes Format) wird abgelehnt", async () => {
    const { app, controller } = setup({ snapshot: "data:image/jpeg;base64,AAAA" });
    await saveViewAsImage(app as never, controller);
    expect(app.vault.createBinary).not.toHaveBeenCalled();
  });
  it("ein Schreibfehler wirft nicht", async () => {
    const { app, controller } = setup({ throwOnCreate: true });
    await expect(saveViewAsImage(app as never, controller)).resolves.toBeUndefined();
  });
});
