import { useEffect, useState } from "react";
import type { PointerEvent as ReactPointerEvent, TouchEvent as ReactTouchEvent } from "react";

import { GamepadBackground } from "./GamepadBackground";
import psController from "./display-mappings/ps-controller.json";
import { Joy, ButtonConfig, BarConfig, StickConfig, DPadConfig, DisplayMapping } from "../types";
import type { ControllerMapping, OutputSlot } from "../controller-mappings/types";

const colStroke = "#ddd";
const colPrim = "blue";
const colSec = "cornflowerblue";
const colAlt = "red";

interface Interaction {
  pointerId: number;
  buttonIdx: number;
  axis1Idx: number;
  axis2Idx: number;
  buttonVal: number;
  axis1Val: number;
  axis2Val: number;
}

enum PointerEventType {
  Down,
  Move,
  Up,
}

function outputSlotIndex(slots: OutputSlot[], name: string | undefined, fallback: number | undefined): number {
  if (name != undefined) {
    const slot = slots.find((candidate) => candidate.name === name);
    if (slot != undefined) {
      return slot.index;
    }
  }

  return fallback ?? -1;
}

function labelFromOutputName(name: string | undefined, fallback: string): string {
  switch (name) {
    case "share_or_create":
      return "Share";
    case "options":
      return "Options";
    case "touchpad":
      return "Touch";
    case "cross":
      return "3";
    case "circle":
      return "2";
    case "square":
      return "4";
    case "triangle":
      return "1";
    default:
      return name ?? fallback;
  }
}

function getMappingDimensions(displayMapping: DisplayMapping, controllerMapping?: ControllerMapping): { numButtons: number; numAxes: number } {
  let maxButton = -1;
  let maxAxis = -1;

  for (const item of displayMapping) {
    if (item.type === "button") {
      const mapping = item as ButtonConfig;
      maxButton = Math.max(
        maxButton,
        outputSlotIndex(controllerMapping?.output.buttons ?? [], mapping.buttonName, mapping.button),
      );
    } else if (item.type === "stick") {
      const mapping = item as StickConfig;
      maxAxis = Math.max(
        maxAxis,
        outputSlotIndex(controllerMapping?.output.axes ?? [], mapping.axisXName, mapping.axisX),
        outputSlotIndex(controllerMapping?.output.axes ?? [], mapping.axisYName, mapping.axisY),
      );
      maxButton = Math.max(
        maxButton,
        outputSlotIndex(controllerMapping?.output.buttons ?? [], mapping.buttonName, mapping.button),
      );
    } else if (item.type === "bar") {
      const mapping = item as BarConfig;
      maxAxis = Math.max(
        maxAxis,
        outputSlotIndex(controllerMapping?.output.axes ?? [], mapping.axisName, mapping.axis),
      );
    } else if (item.type === "d-pad") {
      const mapping = item as DPadConfig;
      maxAxis = Math.max(
        maxAxis,
        outputSlotIndex(controllerMapping?.output.axes ?? [], mapping.axisXName, mapping.axisX),
        outputSlotIndex(controllerMapping?.output.axes ?? [], mapping.axisYName, mapping.axisY),
      );
    }
  }

  return {
    numButtons: maxButton + 1,
    numAxes: maxAxis + 1,
  };
}

function generateButton(
  value: number,
  x: number,
  y: number,
  text: string,
  radius: number,
  downCb: (e: React.PointerEvent) => void,
  upCb: (e: React.PointerEvent) => void,
  cancelCb: (e: React.PointerEvent) => void,
) {
  return (
    <>
      <circle
        cx={x}
        cy={y}
        fill={value > 0 ? colAlt : colPrim}
        r={radius}
        stroke={colStroke}
        strokeWidth={2}
        onPointerDown={downCb}
        onPointerUp={upCb}
        onPointerCancel={cancelCb}
        onLostPointerCapture={cancelCb}
      />
      <text
        textAnchor="middle"
        x={x}
        y={y}
        fill="white"
        dominantBaseline="middle"
        pointerEvents="none"
      >
        {text}
      </text>
    </>
  );
}

function generateBar(value: number, x: number, y: number, rot: number) {
  const width = 80;
  const height = 10;
  const fracwidth = ((-value + 1) * width) / 2;

  const transform =
    "translate(" + x.toString() + "," + y.toString() + ") rotate(" + rot.toString() + ")";
  return (
    <>
      <rect
        width={fracwidth}
        height={height}
        x={-width / 2}
        y={-height / 2}
        fill={colPrim}
        transform={transform}
      />

      <rect
        width={width}
        height={height}
        x={-width / 2}
        y={-height / 2}
        fill="transparent"
        stroke={colStroke}
        transform={transform}
      />
    </>
  );
}

function generateStick(
  valueX: number,
  valueY: number,
  valueButton: number,
  x: number,
  y: number,
  radius: number,
  downCb: (e: React.PointerEvent) => void,
  moveCb: (e: React.PointerEvent) => void,
  upCb: (e: React.PointerEvent) => void,
  cancelCb: (e: React.PointerEvent) => void,
) {
  const offX = -valueX * radius;
  const offY = -valueY * radius;

  return (
    <>
      <circle
        cx={x}
        cy={y}
        fill={colPrim}
        r={radius}
        stroke={colStroke}
        strokeWidth={2}
        onPointerDown={downCb}
        onPointerMove={moveCb}
        onPointerUp={upCb}
        onPointerCancel={cancelCb}
        onLostPointerCapture={cancelCb}
      />
      <circle
        cx={x + offX}
        cy={y + offY}
        fill={valueButton > 0 ? colAlt : colSec}
        r={radius * 0.5}
        stroke="none"
        strokeWidth={2}
        pointerEvents="none"
      />
    </>
  );
}

function generateDPad(valueX: number, valueY: number, x: number, y: number, radius: number) {
  const transform = "translate(" + x.toString() + "," + y.toString() + ")";

  return (
    <>
      <circle cx={x} cy={y} fill="none" r={radius} stroke={colStroke} strokeWidth={2} />
      <polygon
        points="10,15 0,25 -10,15"
        fill={valueY < 0 ? colAlt : colPrim}
        stroke={colStroke}
        strokeWidth={2}
        transform={transform}
      />
      <polygon
        points="10,-15 0,-25 -10,-15"
        fill={valueY > 0 ? colAlt : colPrim}
        stroke={colStroke}
        strokeWidth={2}
        transform={transform}
      />
      <polygon
        points="15,10 25,0 15,-10"
        fill={valueX < 0 ? colAlt : colPrim}
        stroke={colStroke}
        strokeWidth={2}
        transform={transform}
      />
      <polygon
        points="-15,10 -25,0 -15,-10"
        fill={valueX > 0 ? colAlt : colPrim}
        stroke={colStroke}
        strokeWidth={2}
        transform={transform}
      />
    </>
  );
}

function getDPadDirection(
  event: ReactPointerEvent,
): { axisX: number; axisY: number } {
  const dim = event.currentTarget.getBoundingClientRect();
  const x = -(event.clientX - (dim.left + dim.right) / 2) / 30;
  const y = -(event.clientY - (dim.top + dim.bottom) / 2) / 30;

  if (Math.abs(x) > Math.abs(y)) {
    return { axisX: Math.sign(x), axisY: 0 };
  }

  return { axisX: 0, axisY: Math.sign(y) };
}

export function GamepadView(props: {
  joy: Joy | undefined;
  cbInteractChange: (joy: Joy) => void;
  controllerMapping?: ControllerMapping;
}): React.ReactElement {
  const { joy, cbInteractChange, controllerMapping } = props;
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const displayMapping = psController as DisplayMapping;
  const { numButtons, numAxes } = getMappingDimensions(displayMapping, controllerMapping);

  useEffect(() => {
    const tmpJoy = {
      header: {
        frame_id: "",
        stamp: { sec: 0, nsec: 0 },
      },
      buttons: Array<number>(numButtons).fill(0),
      axes: Array<number>(numAxes).fill(0),
    } as Joy;

    interactions.forEach((inter) => {
      if (inter.buttonIdx >= 0 && inter.buttonIdx < numButtons) {
        tmpJoy.buttons[inter.buttonIdx] = inter.buttonVal;
      }

      if (inter.axis1Idx >= 0 && inter.axis1Idx < numAxes) {
        tmpJoy.axes[inter.axis1Idx] = inter.axis1Val;
      }

      if (inter.axis2Idx >= 0 && inter.axis2Idx < numAxes) {
        tmpJoy.axes[inter.axis2Idx] = inter.axis2Val;
      }
    });

    cbInteractChange(tmpJoy);
  }, [numButtons, numAxes, interactions, cbInteractChange]);

  const preventPan = (event: ReactTouchEvent<SVGSVGElement>): void => {
    event.preventDefault();
  };

  const buttonCb = (idx: number, e: React.PointerEvent, eventType: PointerEventType) => {
    switch (eventType) {
      case PointerEventType.Down: {
        // Add it to the list of tracked interactions
        e.currentTarget.setPointerCapture(e.pointerId);
        setInteractions((prevInteractions) => [
          ...prevInteractions.filter((i) => i.pointerId !== e.pointerId),
          {
            pointerId: e.pointerId,
            buttonIdx: idx,
            buttonVal: 1,
            axis1Idx: -1,
            axis1Val: -1,
            axis2Idx: -1,
            axis2Val: -1,
          },
        ]);
        break;
      }
      case PointerEventType.Move: {
        // Don't really need this for buttons
        break;
      }
      case PointerEventType.Up: {
        // Remove from the list
        setInteractions((prevInteractions) =>
          prevInteractions.filter((i) => i.pointerId !== e.pointerId),
        );
        break;
      }
    }
  };

  const axisCb = (
    idxX: number,
    idxY: number,
    e: React.PointerEvent,
    eventType: PointerEventType,
  ) => {
    const dim = e.currentTarget.getBoundingClientRect();
    const x = -(e.clientX - (dim.left + dim.right) / 2) / 30;
    const y = -(e.clientY - (dim.top + dim.bottom) / 2) / 30;
    const r = Math.min(Math.sqrt(x * x + y * y), 1);
    const ang = Math.atan2(y, x);
    const xa = r * Math.cos(ang);
    const ya = r * Math.sin(ang);

    switch (eventType) {
      case PointerEventType.Down: {
        // Add it to the list of tracked interactions
        e.currentTarget.setPointerCapture(e.pointerId);
        setInteractions((prevInteractions) => [
          ...prevInteractions.filter((i) => i.pointerId !== e.pointerId),
          {
            pointerId: e.pointerId,
            buttonIdx: -1,
            buttonVal: -1,
            axis1Idx: idxX,
            axis1Val: xa,
            axis2Idx: idxY,
            axis2Val: ya,
          },
        ]);
        break;
      }
      case PointerEventType.Move: {
        setInteractions((prevInteractions) =>
          prevInteractions.map((v) => {
            if (v.pointerId === e.pointerId) {
              return {
                pointerId: e.pointerId,
                buttonIdx: -1,
                buttonVal: -1,
                axis1Idx: idxX,
                axis1Val: xa,
                axis2Idx: idxY,
                axis2Val: ya,
              };
            } else {
              return v;
            }
          }),
        );
        break;
      }
      case PointerEventType.Up: {
        // Remove from the list
        setInteractions((prevInteractions) =>
          prevInteractions.filter((i) => i.pointerId !== e.pointerId),
        );
        break;
      }
    }
  };

  const dPadCb = (
    idxX: number,
    idxY: number,
    e: ReactPointerEvent,
    eventType: PointerEventType,
  ) => {
    const direction = eventType === PointerEventType.Up ? { axisX: 0, axisY: 0 } : getDPadDirection(e);

    switch (eventType) {
      case PointerEventType.Down: {
        e.currentTarget.setPointerCapture(e.pointerId);
        setInteractions((prevInteractions) => [
          ...prevInteractions.filter((i) => i.pointerId !== e.pointerId),
          {
            pointerId: e.pointerId,
            buttonIdx: -1,
            buttonVal: -1,
            axis1Idx: idxX,
            axis1Val: direction.axisX,
            axis2Idx: idxY,
            axis2Val: direction.axisY,
          },
        ]);
        break;
      }
      case PointerEventType.Move: {
        setInteractions((prevInteractions) =>
          prevInteractions.map((interaction) => {
            if (interaction.pointerId === e.pointerId) {
              return {
                pointerId: e.pointerId,
                buttonIdx: -1,
                buttonVal: -1,
                axis1Idx: idxX,
                axis1Val: direction.axisX,
                axis2Idx: idxY,
                axis2Val: direction.axisY,
              };
            }
            return interaction;
          }),
        );
        break;
      }
      case PointerEventType.Up: {
        setInteractions((prevInteractions) =>
          prevInteractions.filter((i) => i.pointerId !== e.pointerId),
        );
        break;
      }
    }
  };

  const dispItems = displayMapping.map((mappingA, index) => {
    if (mappingA.type === "button") {
      const mapping = mappingA as ButtonConfig;
      const buttonIdx = outputSlotIndex(
        controllerMapping?.output.buttons ?? [],
        mapping.buttonName,
        mapping.button,
      );
      const buttonLabel = labelFromOutputName(
        controllerMapping?.output.buttons.find((slot) => slot.index === buttonIdx)?.name ?? mapping.buttonName,
        mapping.text,
      );
      return (
        <g key={`button-${index}-${buttonIdx}`}>
          {generateButton(
            buttonIdx >= 0 ? (joy?.buttons[buttonIdx] ?? 0) : 0,
            mapping.x,
            mapping.y,
            buttonLabel,
            18,
            (e: ReactPointerEvent) => {
              if (buttonIdx >= 0) {
                buttonCb(buttonIdx, e, PointerEventType.Down);
              }
            },
            (e: ReactPointerEvent) => {
              if (buttonIdx >= 0) {
                buttonCb(buttonIdx, e, PointerEventType.Up);
              }
            },
            (e: ReactPointerEvent) => {
              if (buttonIdx >= 0) {
                buttonCb(buttonIdx, e, PointerEventType.Up);
              }
            },
          )}
        </g>
      );
    }

    if (mappingA.type === "bar") {
      const mapping = mappingA as BarConfig;
      const axisIdx = outputSlotIndex(
        controllerMapping?.output.axes ?? [],
        mapping.axisName,
        mapping.axis,
      );
      return (
        <g key={`bar-${index}-${axisIdx}`}>
          {generateBar(axisIdx >= 0 ? (joy?.axes[axisIdx] ?? 0) : 0, mapping.x, mapping.y, mapping.rot)}
        </g>
      );
    }

    if (mappingA.type === "stick") {
      const mapping = mappingA as StickConfig;
      const axisXIdx = outputSlotIndex(
        controllerMapping?.output.axes ?? [],
        mapping.axisXName,
        mapping.axisX,
      );
      const axisYIdx = outputSlotIndex(
        controllerMapping?.output.axes ?? [],
        mapping.axisYName,
        mapping.axisY,
      );
      const buttonIdx = outputSlotIndex(
        controllerMapping?.output.buttons ?? [],
        mapping.buttonName,
        mapping.button,
      );
      return (
        <g key={`stick-${index}-${axisXIdx}-${axisYIdx}`}>
          {generateStick(
            axisXIdx >= 0 ? (joy?.axes[axisXIdx] ?? 0) : 0,
            axisYIdx >= 0 ? (joy?.axes[axisYIdx] ?? 0) : 0,
            buttonIdx >= 0 ? (joy?.buttons[buttonIdx] ?? 0) : 0,
            mapping.x,
            mapping.y,
            30,
            (e: ReactPointerEvent) => {
              if (axisXIdx >= 0 && axisYIdx >= 0) {
                axisCb(axisXIdx, axisYIdx, e, PointerEventType.Down);
              }
            },
            (e: ReactPointerEvent) => {
              if (axisXIdx >= 0 && axisYIdx >= 0) {
                axisCb(axisXIdx, axisYIdx, e, PointerEventType.Move);
              }
            },
            (e: ReactPointerEvent) => {
              if (axisXIdx >= 0 && axisYIdx >= 0) {
                axisCb(axisXIdx, axisYIdx, e, PointerEventType.Up);
              }
            },
            (e: ReactPointerEvent) => {
              if (axisXIdx >= 0 && axisYIdx >= 0) {
                axisCb(axisXIdx, axisYIdx, e, PointerEventType.Up);
              }
            },
          )}
        </g>
      );
    }

    const mapping = mappingA as DPadConfig;
    const axisXIdx = outputSlotIndex(
      controllerMapping?.output.axes ?? [],
      mapping.axisXName,
      mapping.axisX,
    );
    const axisYIdx = outputSlotIndex(
      controllerMapping?.output.axes ?? [],
      mapping.axisYName,
      mapping.axisY,
    );
    return (
      <g
        key={`dpad-${index}-${axisXIdx}-${axisYIdx}`}
        onPointerDown={(e: ReactPointerEvent) => {
          if (axisXIdx >= 0 && axisYIdx >= 0) {
            dPadCb(axisXIdx, axisYIdx, e, PointerEventType.Down);
          }
        }}
        onPointerMove={(e: ReactPointerEvent) => {
          if (axisXIdx >= 0 && axisYIdx >= 0) {
            dPadCb(axisXIdx, axisYIdx, e, PointerEventType.Move);
          }
        }}
        onPointerUp={(e: ReactPointerEvent) => {
          if (axisXIdx >= 0 && axisYIdx >= 0) {
            dPadCb(axisXIdx, axisYIdx, e, PointerEventType.Up);
          }
        }}
        onPointerCancel={(e: ReactPointerEvent) => {
          if (axisXIdx >= 0 && axisYIdx >= 0) {
            dPadCb(axisXIdx, axisYIdx, e, PointerEventType.Up);
          }
        }}
        onLostPointerCapture={(e: ReactPointerEvent) => {
          if (axisXIdx >= 0 && axisYIdx >= 0) {
            dPadCb(axisXIdx, axisYIdx, e, PointerEventType.Up);
          }
        }}
      >
        {generateDPad(
          axisXIdx >= 0 ? (joy?.axes[axisXIdx] ?? 0) : 0,
          axisYIdx >= 0 ? (joy?.axes[axisYIdx] ?? 0) : 0,
          mapping.x,
          mapping.y,
          30,
        )}
      </g>
    );
  });

  return (
    <div>
      {displayMapping.length === 0 ? <h2>No mapping!</h2> : null}
      <svg
        viewBox="0 0 512 512"
        onTouchStart={preventPan}
        onTouchEnd={preventPan}
        onTouchMove={preventPan}
        onTouchCancel={preventPan}
      >
        <GamepadBackground />
        {dispItems}
      </svg>
    </div>
  );
}
