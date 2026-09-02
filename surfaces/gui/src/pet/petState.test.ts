import { describe, expect, it } from "vitest";
import { aggregateTaskState, stateForAggregate } from "./petState";

describe("pet task state", () => {
  it("keeps the Hulk state while any task is running", () => {
    expect(aggregateTaskState({ running: true, waiting: true, failed: true })).toBe("running");
    expect(stateForAggregate("running")).toBe("running_hulk");
  });

  it("returns Banner when no task is active", () => {
    expect(aggregateTaskState({ running: false })).toBe("idle");
    expect(stateForAggregate("idle")).toBe("idle_banner");
  });

  it("keeps waiting and failed states distinguishable", () => {
    expect(stateForAggregate(aggregateTaskState({ running: false, waiting: true }))).toBe("waiting_banner");
    expect(stateForAggregate(aggregateTaskState({ running: false, failed: true }))).toBe("failed_hulk");
  });
});
