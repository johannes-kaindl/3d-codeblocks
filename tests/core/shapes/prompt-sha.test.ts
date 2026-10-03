import { describe, expect, it } from "vitest";
import { REFINE_SYSTEM } from "../../../src/core/shapes/protocol";
import { promptSha, sha256, userTemplateOutput } from "../../helpers/prompt-sha";

describe("refine prompt pins (an edit needs a new lab run and a new table row)", () => {
  it("pins REFINE_SYSTEM byte for byte", () => {
    expect(sha256(REFINE_SYSTEM)).toBe("fcbdb4da07dc65edd27f4de2b4c62ed544a46fc9078911a0a901a1d8d067b51a");
  });

  it("pins the refine user-message template output for a fixed input", () => {
    expect(sha256(userTemplateOutput("refine"))).toBe("4c9f1301c924474e15fcd2dcfab841b976ea8dbe06644336d9e3d27059136ea8");
  });

  it("promptSha is 16 hex chars and differs per task", () => {
    expect(promptSha("create")).toMatch(/^[0-9a-f]{16}$/);
    expect(promptSha("refine")).toMatch(/^[0-9a-f]{16}$/);
    expect(promptSha("create")).not.toBe(promptSha("refine"));
  });
});
