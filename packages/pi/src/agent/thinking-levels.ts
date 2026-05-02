import {
  clampThinkingLevel as clampModelThinkingLevel,
  getSupportedThinkingLevels,
  type Model,
} from "@mariozechner/pi-ai";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";

export function getAvailableThinkingLevels(model: Model<any> | null | undefined): ThinkingLevel[] {
  if (!model) {
    return ["off"];
  }

  return getSupportedThinkingLevels(model) as ThinkingLevel[];
}

export function clampThinkingLevel(
  level: ThinkingLevel,
  model: Model<any> | null | undefined,
): ThinkingLevel {
  return model ? (clampModelThinkingLevel(model, level) as ThinkingLevel) : "off";
}

export function formatThinkingLevelLabel(level: ThinkingLevel): string {
  if (level === "xhigh") {
    return "XHigh";
  }

  return `${level.slice(0, 1).toUpperCase()}${level.slice(1)}`;
}
