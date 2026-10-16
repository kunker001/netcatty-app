import type { Host } from "../../../domain/models";

export function mapTerminalBackspaceInput(
  data: string,
  behavior: Host["backspaceBehavior"],
): string {
  return data === "\x7f" && behavior === "ctrl-h" ? "\x08" : data;
}
