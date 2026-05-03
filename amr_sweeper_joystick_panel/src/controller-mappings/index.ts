import standardPs from "./standard-ps.json";
import type { ControllerMapping } from "./types";

export const controllerMappings: ControllerMapping[] = [
  standardPs as unknown as ControllerMapping,
];

export const defaultControllerMappingId = "standard-ps";

export function getControllerMapping(id: string): ControllerMapping {
  const mapping =
    controllerMappings.find((candidate) => candidate.id === id) ??
    controllerMappings.find((candidate) => candidate.id === defaultControllerMappingId);

  if (mapping == undefined) {
    throw new Error("No controller mappings are registered.");
  }

  return mapping;
}
