import esperanzaWireless from "./esperanza-wireless.json";
import gembirdWired from "./gembird-wired.json";
import type { ControllerMapping } from "./types";

export const controllerMappings: ControllerMapping[] = [
  esperanzaWireless as unknown as ControllerMapping,
  gembirdWired as unknown as ControllerMapping,
];

export const defaultControllerMappingId = "esperanza-wireless";

export function getControllerMapping(id: string): ControllerMapping {
  const mapping =
    controllerMappings.find((candidate) => candidate.id === id) ??
    controllerMappings.find((candidate) => candidate.id === defaultControllerMappingId);

  if (mapping == undefined) {
    throw new Error("No controller mappings are registered.");
  }

  return mapping;
}
