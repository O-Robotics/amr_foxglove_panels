import type { Joy } from "../types";
import type {
  AxisMapping,
  AxisSource,
  AxisTransform,
  ControllerMapping,
  OutputSlot,
} from "./types";

type JoyHeader = Joy["header"];

export function joyFromGamepad(
  gamepad: Gamepad,
  mapping: ControllerMapping,
  header: JoyHeader,
): Joy {
  const axes = createOutputArray(mapping.output.axes);
  const buttons = createOutputArray(mapping.output.buttons);

  for (const axisMapping of mapping.axisMappings) {
    const value = applyAxisTransform(
      readAxisSource(gamepad, axisMapping.source),
      axisMapping.transform,
    );
    writeMappedValue(axisMapping, value, axes, buttons);
  }

  for (const buttonMapping of mapping.buttonMappings) {
    const value = readButtonValue(gamepad, buttonMapping.source.index);
    const threshold = buttonMapping.source.threshold ?? 0.5;
    writeMappedValue(buttonMapping, value >= threshold ? 1 : 0, axes, buttons);
  }

  return {
    header,
    axes,
    buttons,
  };
}

export function controllerMatchesGamepad(mapping: ControllerMapping, gamepad: Gamepad): boolean {
  if (mapping.match?.mapping != undefined && mapping.match.mapping !== gamepad.mapping) {
    return false;
  }

  const idIncludesAny = mapping.match?.idIncludesAny;
  if (idIncludesAny == undefined || idIncludesAny.length === 0) {
    return true;
  }

  const gamepadId = gamepad.id.toLocaleLowerCase();
  return idIncludesAny.some((candidate) => gamepadId.includes(candidate.toLocaleLowerCase()));
}

export function createNeutralJoy(mapping: ControllerMapping, header: JoyHeader): Joy {
  return {
    header,
    axes: createOutputArray(mapping.output.axes),
    buttons: createOutputArray(mapping.output.buttons),
  };
}

function createOutputArray(slots: OutputSlot[]): number[] {
  const maxIndex = slots.reduce((max, slot) => Math.max(max, slot.index), -1);
  const output = Array<number>(maxIndex + 1).fill(0);

  for (const slot of slots) {
    output[slot.index] = slot.neutral;
  }

  return output;
}

function readAxisSource(gamepad: Gamepad, source: AxisSource): number {
  if (source.type === "axis") {
    return gamepad.axes[source.index] ?? 0;
  }

  if (source.type === "button") {
    return readButtonValue(gamepad, source.index);
  }

  if (source.type === "hatAxis") {
    return readHatAxis(gamepad.axes[source.index] ?? 3.29, source.direction);
  }

  return (
    readButtonValue(gamepad, source.positiveIndex) -
    readButtonValue(gamepad, source.negativeIndex)
  );
}

function readHatAxis(value: number, direction: "x" | "y"): number {
  const tolerance = 0.12;
  const isNear = (target: number) => Math.abs(value - target) <= tolerance;

  if (direction === "x") {
    if (isNear(0.71)) {
      return 1;
    }
    if (isNear(-0.43)) {
      return -1;
    }
    return 0;
  }

  if (isNear(-1)) {
    return 1;
  }
  if (isNear(0.14)) {
    return -1;
  }
  return 0;
}

function readButtonValue(gamepad: Gamepad, index: number): number {
  const button = gamepad.buttons[index];
  if (button == undefined) {
    return 0;
  }

  return button.value;
}

function applyAxisTransform(value: number, transform?: AxisTransform): number {
  let nextValue = Math.abs(value) < (transform?.deadzone ?? 0) ? 0 : value;
  nextValue = nextValue * (transform?.scale ?? 1) + (transform?.offset ?? 0);

  if (transform?.clamp != undefined) {
    const [min, max] = transform.clamp;
    nextValue = Math.min(Math.max(nextValue, min), max);
  }

  return nextValue;
}

function writeMappedValue(
  mapping: Pick<AxisMapping, "target">,
  value: number,
  axes: number[],
  buttons: number[],
): void {
  if (mapping.target.type === "axis") {
    axes[mapping.target.index] = value;
  } else {
    buttons[mapping.target.index] = value;
  }
}
