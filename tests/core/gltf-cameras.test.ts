import { describe, expect, it } from "vitest";
import { fileCameraNames, fileCameraNotes, findFileCamera, type FileCameraInfo } from "../../src/core/gltf-cameras";

const cam = (nodeName: string | null, cameraName: string | null, orthographic = false): FileCameraInfo =>
  ({ nodeName, cameraName, orthographic });

describe("findFileCamera", () => {
  it("finds a node by its name", () => {
    const list = [cam("Section", "Camera"), cam("Front", "Camera")];
    expect(findFileCamera(list, "Front")).toEqual({ kind: "found", index: 1, ambiguous: false });
  });

  it("prefers the node name over the camera name", () => {
    const list = [cam("Section", "Front"), cam("Front", "Camera")];
    expect(findFileCamera(list, "Front")).toEqual({ kind: "found", index: 1, ambiguous: false });
  });

  it("falls back to the camera name when no node matches", () => {
    const list = [cam(null, "Section"), cam("Front", "Camera")];
    expect(findFileCamera(list, "Section")).toEqual({ kind: "found", index: 0, ambiguous: false });
  });

  it("ignores case", () => {
    expect(findFileCamera([cam("Schnitt", null)], "schnitt")).toEqual({
      kind: "found", index: 0, ambiguous: false,
    });
  });

  it("keeps a name with spaces addressable", () => {
    expect(findFileCamera([cam("Schnitt A", null)], "Schnitt A")).toEqual({
      kind: "found", index: 0, ambiguous: false,
    });
  });

  it("takes the first of two identically named nodes and says so", () => {
    const list = [cam("Front", null), cam("Front", null)];
    expect(findFileCamera(list, "Front")).toEqual({ kind: "found", index: 0, ambiguous: true });
  });

  it("reports an orthographic match instead of returning it", () => {
    expect(findFileCamera([cam("Plan", null, true)], "Plan")).toEqual({ kind: "orthographic", index: 0 });
  });

  it("reports a miss", () => {
    expect(findFileCamera([cam("Front", null)], "Section")).toEqual({ kind: "not-found" });
  });

  it("reports a miss on an empty list", () => {
    expect(findFileCamera([], "Front")).toEqual({ kind: "not-found" });
  });
});

describe("fileCameraNames", () => {
  it("lists node names, falling back to camera names", () => {
    expect(fileCameraNames([cam("Front", "Camera"), cam(null, "Section"), cam(null, null)])).toEqual([
      "Front", "Section",
    ]);
  });
});

describe("fileCameraNotes", () => {
  it("names what the file offers when nothing matched", () => {
    const list = [cam("Front", null), cam("Top", null)];
    expect(fileCameraNotes({ kind: "not-found" }, "Section", list)).toEqual([
      "unknown camera `Section` — this file has: Front, Top",
    ]);
  });

  it("says so when the file has no cameras at all", () => {
    expect(fileCameraNotes({ kind: "not-found" }, "Section", [])).toEqual([
      "unknown camera `Section` — this file has no cameras",
    ]);
  });

  it("explains an orthographic camera", () => {
    expect(fileCameraNotes({ kind: "orthographic", index: 0 }, "Plan", [cam("Plan", null, true)])).toEqual([
      "`Plan` is an orthographic camera — not supported",
    ]);
  });

  it("warns about an ambiguous name but still uses one", () => {
    const list = [cam("Front", null), cam("Front", null)];
    expect(fileCameraNotes({ kind: "found", index: 0, ambiguous: true }, "Front", list)).toEqual([
      "`Front` names more than one camera — using the first",
    ]);
  });

  it("stays silent on a clean hit", () => {
    expect(fileCameraNotes({ kind: "found", index: 0, ambiguous: false }, "Front", [cam("Front", null)])).toEqual([]);
  });
});

describe("findFileCamera and orthographic siblings", () => {
  it("prefers a usable camera over an orthographic one of the same name", () => {
    // Der Ortho-Treffer steht zuerst — trotzdem gewinnt die brauchbare Kamera.
    const list = [cam("Front", null, true), cam("Front", null)];
    expect(findFileCamera(list, "Front")).toEqual({ kind: "found", index: 1, ambiguous: false });
  });

  it("reports orthographic only when every match is orthographic", () => {
    const list = [cam("Plan", null, true), cam("Plan", null, true)];
    expect(findFileCamera(list, "Plan")).toEqual({ kind: "orthographic", index: 0 });
  });

  it("is not ambiguous when only one match is usable", () => {
    const list = [cam("Front", null), cam("Front", null, true)];
    expect(findFileCamera(list, "Front")).toEqual({ kind: "found", index: 0, ambiguous: false });
  });
});

describe("fileCameraNames", () => {
  it("names a duplicate only once", () => {
    // Sonst stuende "this file has: Doppel, Doppel" in der Meldung.
    expect(fileCameraNames([cam("Doppel", null), cam("Doppel", null)])).toEqual(["Doppel"]);
  });
});
