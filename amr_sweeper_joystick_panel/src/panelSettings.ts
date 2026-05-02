import { Topic, SettingsTreeNodes, SettingsTreeFields, SettingsTreeAction } from "@foxglove/studio";
import { produce } from "immer";
import * as _ from "lodash-es";

import { controllerMappings } from "./controller-mappings";

export type Config = {
  dataSource: string;
  subJoyTopic: string;
  gamepadId: number;
  controllerMappingId: string;
  publishMode: boolean;
  pubJoyTopic: string;
  publishFrameId: string;
  displayMode: string;
  debugGamepad: boolean;
  layoutName: string;
};

function buildGamepadOptions(selectedGamepadId: number, gamepadIds: readonly number[]): { label: string; value: string }[] {
  const ids = Array.from(new Set([...gamepadIds, selectedGamepadId])).sort((a, b) => a - b);

  return ids.map((id) => ({
    label: id.toString(),
    value: id.toString(),
  }));
}

export function settingsActionReducer(prevConfig: Config, action: SettingsTreeAction): Config {
  return produce(prevConfig, (draft) => {
    if (action.action === "update") {
      const { path, value } = action.payload;
      const configPath = path.slice(1);

      if (configPath[0] === "gamepadId" && typeof value === "string") {
        _.set(draft, configPath, Number(value));
      } else if (configPath[0] === "dataSource" && value === "sub-joy-topic") {
        _.set(draft, configPath, value);
        draft.publishMode = false;
      } else if (configPath[0] === "publishMode" && draft.dataSource === "sub-joy-topic") {
        draft.publishMode = false;
      } else {
        _.set(draft, configPath, value);
      }
    }
  });
}

export function buildSettingsTree(
  config: Config,
  topics?: readonly Topic[],
  gamepadIds: readonly number[] = [],
): SettingsTreeNodes {
  const dataSourceFields: SettingsTreeFields = {
    dataSource: {
      label: "Data Source",
      input: "select",
      value: config.dataSource,
      options: [
        {
          label: "Subscribed Joy Topic",
          value: "sub-joy-topic",
        },
        {
          label: "Gamepad",
          value: "gamepad",
        },
        {
          label: "Interactive",
          value: "interactive",
        },
        {
          label: "Keyboard",
          value: "keyboard",
        },
      ],
    },
    subJoyTopic: {
      label: "Subsc. Joy Topic",
      input: "select",
      value: config.subJoyTopic,
      disabled: config.dataSource !== "sub-joy-topic",
      options: (topics ?? [])
        .filter((topic) => topic.datatype === "sensor_msgs/msg/Joy")
        .map((topic) => ({
          label: topic.name,
          value: topic.name,
        })),
      // error: (!config.topic ? "Topic name is empty" : null),
    },
    gamepadId: {
      label: "Gamepad ID",
      input: "select",
      value: config.gamepadId.toString(),
      disabled: config.dataSource !== "gamepad",
      options: buildGamepadOptions(config.gamepadId, gamepadIds),
    },
    controllerMappingId: {
      label: "Controller Mapping",
      input: "select",
      value: config.controllerMappingId,
      disabled: config.dataSource !== "gamepad",
      options: controllerMappings.map((mapping) => ({
        label: mapping.label,
        value: mapping.id,
      })),
    },
  };
  const publishFields: SettingsTreeFields = {
    publishMode: {
      label: "Publish Mode",
      input: "boolean",
      value: config.publishMode,
      disabled: config.dataSource === "sub-joy-topic", // TODO also need to force publish mode to false when in sub mode
    },
    pubJoyTopic: {
      label: "Pub Joy Topic",
      input: "string",
      value: config.pubJoyTopic,
    },
    publishFrameId: {
      label: "Joy Frame ID",
      input: "string",
      value: config.publishFrameId,
    },
  };
  const displayFields: SettingsTreeFields = {
    displayMode: {
      label: "Display Mode",
      input: "select",
      value: config.displayMode,
      options: [
        {
          label: "Auto-Generated",
          value: "auto",
        },
        {
          label: "Custom Display",
          value: "custom",
        },
      ],
    },
    layoutName: {
      label: "Layout",
      input: "select",
      disabled: config.displayMode === "auto",
      value: config.layoutName,
      options: [
        {
          label: "PS Controller",
          value: "ps-controller",
        },
        {
          label: "Steam Deck",
          value: "steamdeck",
        },
        {
          label: "iPega PG-9083s",
          value: "ipega-9083s",
        },
      ],
    },

    debugGamepad: {
      label: "Debug Gamepad",
      input: "boolean",
      value: config.debugGamepad,
    },
  };

  const settings: SettingsTreeNodes = {
    dataSource: {
      label: "Data Source",
      fields: dataSourceFields,
    },
    publish: {
      label: "Publish",
      fields: publishFields,
    },
    display: {
      label: "Display",
      fields: displayFields,
    },
  };

  return settings;
}
