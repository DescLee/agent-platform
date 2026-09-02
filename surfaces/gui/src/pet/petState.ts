export type AggregateTaskState = "idle" | "running" | "waiting" | "failed";

export type PetState =
  | "idle_banner"
  | "waiting_banner"
  | "transforming"
  | "running_hulk"
  | "failed_hulk"
  | "returning";

export type PetStateEvent = {
  state: AggregateTaskState;
  taskCount: number;
  activeTaskId?: string;
  occurredAt: number;
};

export function aggregateTaskState(input: {
  running: boolean;
  waiting?: boolean;
  failed?: boolean;
}): AggregateTaskState {
  if (input.running) return "running";
  if (input.waiting) return "waiting";
  if (input.failed) return "failed";
  return "idle";
}

export function stateForAggregate(state: AggregateTaskState): PetState {
  switch (state) {
    case "running":
      return "running_hulk";
    case "waiting":
      return "waiting_banner";
    case "failed":
      return "failed_hulk";
    default:
      return "idle_banner";
  }
}
