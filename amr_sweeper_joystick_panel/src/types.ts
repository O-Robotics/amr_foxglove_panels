import { Time } from "@foxglove/rostime";

type Header = {
  stamp: Time;
  frame_id: string;
};

// sensor_msgs/Joy message definition
// http://docs.ros.org/en/api/sensor_msgs/html/msg/Joy.html
export type Joy = {
  header: Header;
  axes: number[];
  buttons: number[];
};

export interface ButtonConfig {
  type: string;
  text: string;
  x: number;
  y: number;
  rot: number;
  button?: number;
  buttonName?: string;
}

export interface BarConfig {
  type: string;
  x: number;
  y: number;
  rot: number;
  axis?: number;
  axisName?: string;
}

export interface StickConfig {
  type: string;
  x: number;
  y: number;
  axisX?: number;
  axisY?: number;
  axisXName?: string;
  axisYName?: string;
  button?: number;
  buttonName?: string;
}

export interface DPadConfig {
  type: string;
  x: number;
  y: number;
  axisX?: number;
  axisY?: number;
  axisXName?: string;
  axisYName?: string;
}

export type DisplayMapping = (ButtonConfig | BarConfig | StickConfig | DPadConfig)[];
