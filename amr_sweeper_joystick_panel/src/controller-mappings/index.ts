import psStandard from "./ps-standard.json";
import type { ControllerMapping } from "./types";

export const controllerMappings: ControllerMapping[] = [psStandard as ControllerMapping];

export const defaultControllerMappingId = "ps-standard";

export function getControllerMapping(id: string): ControllerMapping {
  const mapping =
    controllerMappings.find((candidate) => candidate.id === id) ??
    controllerMappings.find((candidate) => candidate.id === defaultControllerMappingId);

  if (mapping == undefined) {
    throw new Error("No controller mappings are registered.");
  }

  return mapping;
}
