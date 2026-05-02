export type ControllerMapping = {
  schemaVersion: 1;
  id: string;
  label: string;
  description?: string;
  match?: {
    mapping?: string;
    idIncludesAny?: string[];
  };
  output: {
    messageType: "sensor_msgs/msg/Joy";
    axes: OutputSlot[];
    buttons: OutputSlot[];
  };
  axisMappings: AxisMapping[];
  buttonMappings: ButtonMapping[];
};

export type OutputSlot = {
  index: number;
  name: string;
  neutral: number;
  description?: string;
};

export type MappingTarget = {
  type: "axis" | "button";
  index: number;
};

export type AxisSource =
  | {
      type: "axis";
      index: number;
    }
  | {
      type: "button";
      index: number;
      read: "value";
    }
  | {
      type: "buttonPair";
      positiveIndex: number;
      negativeIndex: number;
    }
  | {
      type: "hatAxis";
      index: number;
      direction: "x" | "y";
    };

export type AxisTransform = {
  scale?: number;
  offset?: number;
  deadzone?: number;
  clamp?: [number, number];
};

export type AxisMapping = {
  action: string;
  source: AxisSource;
  target: MappingTarget;
  transform?: AxisTransform;
};

export type ButtonMapping = {
  action: string;
  source: {
    type: "button";
    index: number;
    threshold?: number;
  };
  target: MappingTarget;
};
