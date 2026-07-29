import { describe, expect, it } from "vitest";
import { BADGE_LABEL, editBadgeState } from "../../src/core/edit-badge";

const always = () => true;
const never = () => false;

describe("editBadgeState", () => {
  it("zeigt den Hinweis, wenn neben dem Original eine .edit.-Datei liegt", () => {
    const state = editBadgeState({
      modelPath: "weltmodell/3d/eg.gltf",
      editing: false,
      exists: always,
    });

    expect(state.visible).toBe(true);
    expect(state.label).toBe(BADGE_LABEL);
    // Der Tooltip muss den Pfad nennen -- ohne ihn weiss der Nutzer nicht, WO die
    // gespeicherte Arbeit liegt, und der Hinweis waere nur ein Rätsel mehr.
    expect(state.title).toContain("weltmodell/3d/eg.edit.gltf");
  });

  it("fragt genau den abgeleiteten Edit-Pfad ab, nicht den Modell-Pfad", () => {
    const asked: string[] = [];
    editBadgeState({
      modelPath: "haus.glb",
      editing: false,
      exists: (path) => {
        asked.push(path);
        return false;
      },
    });

    expect(asked).toEqual(["haus.edit.glb"]);
  });

  it("bleibt still, wenn es gar keine Edit-Datei gibt", () => {
    expect(
      editBadgeState({ modelPath: "eg.gltf", editing: false, exists: never }).visible,
    ).toBe(false);
  });

  it("bleibt still im Edit-Modus -- dort sind die Edits ohnehin zu sehen", () => {
    expect(editBadgeState({ modelPath: "eg.gltf", editing: true, exists: always }).visible).toBe(
      false,
    );
  });

  it("bleibt still, solange nichts geladen ist", () => {
    expect(editBadgeState({ modelPath: null, editing: false, exists: always }).visible).toBe(false);
  });

  it("bleibt still bei nicht editierbaren Formaten (STL)", () => {
    expect(editBadgeState({ modelPath: "teil.stl", editing: false, exists: always }).visible).toBe(
      false,
    );
  });

  it("bleibt still, wenn die Edit-Datei SELBST betrachtet wird", () => {
    // Sonst behauptete der Hinweis, es gebe woanders Edits -- dabei schaut der Nutzer
    // genau auf sie. `editTargetPath` meldet diesen Fall als `inPlace`.
    expect(
      editBadgeState({ modelPath: "eg.edit.gltf", editing: false, exists: always }).visible,
    ).toBe(false);
  });
});
