import { describe, expect, it } from "vitest";
import { makeFakeEl } from "./__mocks__/obsidian";

describe("test setup", () => {
  it("provides a fake element that records children", () => {
    const el = makeFakeEl();
    el.createDiv({ cls: "tdcb-x", text: "hello" });
    expect(el.children).toHaveLength(1);
    expect(el.children[0].className).toBe("tdcb-x");
    expect(el.children[0].textContent).toBe("hello");
  });
});
