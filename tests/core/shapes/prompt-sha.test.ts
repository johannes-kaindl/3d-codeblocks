import { describe, expect, it } from "vitest";
import { REFINE_SYSTEM } from "../../../src/core/shapes/protocol";
import { promptSha, sha256, userTemplateOutput } from "../../helpers/prompt-sha";

describe("refine prompt pins (an edit needs a new lab run and a new table row)", () => {
  it("pins REFINE_SYSTEM byte for byte", () => {
    expect(sha256(REFINE_SYSTEM)).toBe("959905acad152013b953aac50062c930776b4082d44dd19d189f5dc48ebc9b13");
  });

  it("pins the refine user-message template output for a fixed input", () => {
    expect(sha256(userTemplateOutput("refine"))).toBe("4c9f1301c924474e15fcd2dcfab841b976ea8dbe06644336d9e3d27059136ea8");
  });

  it("pins the refine promptSha (the value a refine table row must carry)", () => {
    expect(promptSha("refine")).toBe("71051822eb114cf6");
    expect(promptSha("create")).toBe("6d29c7c76d4532f2");
  });

  it("promptSha is 16 hex chars and differs per task", () => {
    expect(promptSha("create")).toMatch(/^[0-9a-f]{16}$/);
    expect(promptSha("refine")).toMatch(/^[0-9a-f]{16}$/);
    expect(promptSha("create")).not.toBe(promptSha("refine"));
  });
});
