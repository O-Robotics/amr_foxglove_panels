import { useEffect, useState } from "react";
import type { PointerEvent as ReactPointerEvent, TouchEvent as ReactTouchEvent } from "react";

import { GamepadBackground } from "./GamepadBackground";
import cheapo from "./display-mappings/cheapo.json";
import ipega9083s from "./display-mappings/ipega-9083s.json";
import steamdeck from "./display-mappings/steamdeck.json";
import xboxOld from "./display-mappings/xbox-old.json";
import xboxNew from "./display-mappings/xbox-new.json";
import { Joy, ButtonConfig, BarConfig, StickConfig, DPadConfig, DisplayMapping } from "../types";

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

const xboxOldDisplayMapping = applyCheapoGeometry(xboxOld as DisplayMapping);
const xboxNewDisplayMapping = applyCheapoGeometry(xboxNew as DisplayMapping);

function getDisplayMapping(layoutName: string): DisplayMapping {
  switch (layoutName) {
    case "steamdeck":
      return steamdeck;
    case "ipega-9083s":
      return ipega9083s;
    case "xbox-old":
      return xboxOldDisplayMapping;
    case "xbox-new":
      return xboxNewDisplayMapping;
    case "cheapo":
      return cheapo;
    default:
      return [];
  }
}

function getMappingDimensions(displayMapping: DisplayMapping): { numButtons: number; numAxes: number } {
  let maxButton = -1;
  let maxAxis = -1;

  for (const item of displayMapping) {
    if (item.type === "button") {
      maxButton = Math.max(maxButton, (item as ButtonConfig).button);
    } else if (item.type === "stick") {
      const mapping = item as StickConfig;
      maxAxis = Math.max(maxAxis, mapping.axisX, mapping.axisY);
    }
  }

  return {
    numButtons: maxButton + 1,
    numAxes: maxAxis + 1,
  };
}

function applyCheapoGeometry(mapping: DisplayMapping): DisplayMapping {
  const cheapoButtons = cheapo.filter((item) => item.type === "button") as ButtonConfig[];
  const cheapoBars = cheapo.filter((item) => item.type === "bar") as BarConfig[];
  const cheapoSticks = cheapo.filter((item) => item.type === "stick") as StickConfig[];
  const cheapoDPads = cheapo.filter((item) => item.type === "d-pad") as DPadConfig[];

  return mapping.map((item) => {
    if (item.type === "button") {
      const mapped = item as ButtonConfig;
      const reference = cheapoButtons.find((btn) => btn.text === mapped.text);
      return reference ? { ...mapped, x: reference.x, y: reference.y, rot: reference.rot } : mapped;
    }

    if (item.type === "bar") {
      const mapped = item as BarConfig;
      const reference = cheapoBars.find((bar) => bar.axis === mapped.axis);
      return reference ? { ...mapped, x: reference.x, y: reference.y, rot: reference.rot } : mapped;
    }

    if (item.type === "stick") {
      const mapped = item as StickConfig;
      const reference = cheapoSticks.find(
        (stick) => stick.axisX === mapped.axisX && stick.axisY === mapped.axisY,
      );
      return reference ? { ...mapped, x: reference.x, y: reference.y } : mapped;
    }

    if (item.type === "d-pad") {
      const mapped = item as DPadConfig;
      const reference = cheapoDPads.find(
        (dpad) => dpad.axisX === mapped.axisX && dpad.axisY === mapped.axisY,
      );
      return reference ? { ...mapped, x: reference.x, y: reference.y } : mapped;
    }

    return item;
  });
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
  layoutName: string;
}): React.ReactElement {
  const { joy, cbInteractChange, layoutName } = props;
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const displayMapping = getDisplayMapping(layoutName);
  const { numButtons, numAxes } = getMappingDimensions(displayMapping);

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
      const buttonIdx = mapping.button;
      return (
        <g key={`button-${index}-${buttonIdx}`}>
          {generateButton(
            joy?.buttons[buttonIdx] ?? 0,
            mapping.x,
            mapping.y,
            mapping.text,
            18,
            (e: ReactPointerEvent) => {
              buttonCb(buttonIdx, e, PointerEventType.Down);
            },
            (e: ReactPointerEvent) => {
              buttonCb(buttonIdx, e, PointerEventType.Up);
            },
            (e: ReactPointerEvent) => {
              buttonCb(buttonIdx, e, PointerEventType.Up);
            },
          )}
        </g>
      );
    }

    if (mappingA.type === "bar") {
      const mapping = mappingA as BarConfig;
      return (
        <g key={`bar-${index}-${mapping.axis}`}>
          {generateBar(joy?.axes[mapping.axis] ?? 0, mapping.x, mapping.y, mapping.rot)}
        </g>
      );
    }

    if (mappingA.type === "stick") {
      const mapping = mappingA as StickConfig;
      return (
        <g key={`stick-${index}-${mapping.axisX}-${mapping.axisY}`}>
          {generateStick(
            joy?.axes[mapping.axisX] ?? 0,
            joy?.axes[mapping.axisY] ?? 0,
            joy?.buttons[mapping.button] ?? 0,
            mapping.x,
            mapping.y,
            30,
            (e: ReactPointerEvent) => {
              axisCb(mapping.axisX, mapping.axisY, e, PointerEventType.Down);
            },
            (e: ReactPointerEvent) => {
              axisCb(mapping.axisX, mapping.axisY, e, PointerEventType.Move);
            },
            (e: ReactPointerEvent) => {
              axisCb(mapping.axisX, mapping.axisY, e, PointerEventType.Up);
            },
            (e: ReactPointerEvent) => {
              axisCb(mapping.axisX, mapping.axisY, e, PointerEventType.Up);
            },
          )}
        </g>
      );
    }

    const mapping = mappingA as DPadConfig;
    return (
      <g
        key={`dpad-${index}-${mapping.axisX}-${mapping.axisY}`}
        onPointerDown={(e: ReactPointerEvent) => {
          dPadCb(mapping.axisX, mapping.axisY, e, PointerEventType.Down);
        }}
        onPointerMove={(e: ReactPointerEvent) => {
          dPadCb(mapping.axisX, mapping.axisY, e, PointerEventType.Move);
        }}
        onPointerUp={(e: ReactPointerEvent) => {
          dPadCb(mapping.axisX, mapping.axisY, e, PointerEventType.Up);
        }}
        onPointerCancel={(e: ReactPointerEvent) => {
          dPadCb(mapping.axisX, mapping.axisY, e, PointerEventType.Up);
        }}
        onLostPointerCapture={(e: ReactPointerEvent) => {
          dPadCb(mapping.axisX, mapping.axisY, e, PointerEventType.Up);
        }}
      >
        {generateDPad(joy?.axes[mapping.axisX] ?? 0, joy?.axes[mapping.axisY] ?? 0, mapping.x, mapping.y, 30)}
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
        <GamepadBackground layoutName={layoutName} />
        {dispItems}
      </svg>
    </div>
  );
}
