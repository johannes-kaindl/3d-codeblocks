import { describe, expect, it } from "vitest";
import { pickEvictions } from "../../src/core/context-budget";

describe("pickEvictions", () => {
  it("evicts nothing below the limit", () => {
    expect(pickEvictions([{ id: "a", lastUsedAt: 1 }], 6)).toEqual([]);
  });

  it("evicts nothing exactly at the limit", () => {
    const active = [
      { id: "a", lastUsedAt: 1 },
      { id: "b", lastUsedAt: 2 },
    ];
    expect(pickEvictions(active, 2)).toEqual([]);
  });

  it("evicts the least recently used first", () => {
    const active = [
      { id: "a", lastUsedAt: 30 },
      { id: "b", lastUsedAt: 10 },
      { id: "c", lastUsedAt: 20 },
    ];
    expect(pickEvictions(active, 2)).toEqual(["b"]);
  });

  it("evicts several when far over the limit", () => {
    const active = [
      { id: "a", lastUsedAt: 40 },
      { id: "b", lastUsedAt: 10 },
      { id: "c", lastUsedAt: 20 },
      { id: "d", lastUsedAt: 30 },
    ];
    expect(pickEvictions(active, 2)).toEqual(["b", "c"]);
  });

  it("breaks ties by id so the result is deterministic", () => {
    const active = [
      { id: "b", lastUsedAt: 5 },
      { id: "a", lastUsedAt: 5 },
      { id: "c", lastUsedAt: 9 },
    ];
    expect(pickEvictions(active, 2)).toEqual(["a"]);
  });

  it("treats a limit below one as one", () => {
    const active = [
      { id: "a", lastUsedAt: 1 },
      { id: "b", lastUsedAt: 2 },
    ];
    expect(pickEvictions(active, 0)).toEqual(["a"]);
  });

  it("does not mutate the input array", () => {
    const active = [
      { id: "a", lastUsedAt: 3 },
      { id: "b", lastUsedAt: 1 },
    ];
    pickEvictions(active, 1);
    expect(active[0].id).toBe("a");
  });
});
