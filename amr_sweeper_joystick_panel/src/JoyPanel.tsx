import { fromDate } from "@foxglove/rostime";
import {
  Immutable,
  MessageEvent,
  PanelExtensionContext,
  Topic,
  SettingsTreeAction,
} from "@foxglove/studio";
import { FormGroup, FormControlLabel, Switch } from "@mui/material";
import { useEffect, useLayoutEffect, useState, useCallback, useMemo, useRef } from "react";
import ReactDOM from "react-dom";

// import { GamepadDebug } from "./components/GamepadDebug";
import { GamepadView } from "./components/GamepadView";
import kbmapping1 from "./components/kbmapping1.json";
import { defaultControllerMappingId, getControllerMapping } from "./controller-mappings";
import {
  controllerMatchesGamepad,
  createNeutralJoy,
  joyFromGamepad,
} from "./controller-mappings/applyControllerMapping";
import { useGamepad } from "./hooks/useGamepad";
import { Config, buildSettingsTree, settingsActionReducer } from "./panelSettings";
import { Joy } from "./types";

type KbMap = {
  button: number;
  axis: number;
  direction: number;
  value: number;
};

type RawGamepadState = {
  id: string;
  mapping: string;
  axes: number[];
  buttons: number[];
};

function keyToCode(key: string): string {
  if (key === " ") {
    return "Space";
  }
  if (key.length === 1 && key >= "a" && key <= "z") {
    return `Key${key.toUpperCase()}`;
  }
  return key;
}

function joyFromKeyboardMap(trackedKeys: Map<string, KbMap>, frameId: string): Joy {
  const axes: number[] = [];
  const buttons: number[] = [];

  trackedKeys.forEach((value) => {
    if (value.button >= 0) {
      while (buttons.length <= value.button) {
        buttons.push(0);
      }
      buttons[value.button] = value.value;
    } else if (value.axis >= 0) {
      while (axes.length <= value.axis) {
        axes.push(0);
      }
      axes[value.axis] += (value.direction > 0 ? 1 : -1) * value.value;
    }
  });

  return {
    header: {
      frame_id: frameId,
      stamp: fromDate(new Date()), // TODO: /clock
    },
    axes,
    buttons,
  };
}

function getConnectedGamepadIds(): number[] {
  if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") {
    return [];
  }

  return navigator
    .getGamepads()
    .filter((gamepad): gamepad is Gamepad => gamepad != null)
    .map((gamepad) => gamepad.index)
    .sort((a, b) => a - b);
}

function joyHeader(frameId: string): Joy["header"] {
  return {
    frame_id: frameId,
    stamp: fromDate(new Date()), // TODO: /clock
  };
}

function getActiveControllerMapping(gamepad: Gamepad, preferredMappingId: string) {
  const preferredMapping = getControllerMapping(preferredMappingId);
  if (controllerMatchesGamepad(preferredMapping, gamepad)) {
    return preferredMapping;
  }

  return undefined;
}

function snapshotGamepad(gamepad: Gamepad): RawGamepadState {
  return {
    id: gamepad.id,
    mapping: gamepad.mapping,
    axes: Array.from(gamepad.axes),
    buttons: gamepad.buttons.map((button) => button.value),
  };
}

function copyJoyMessage(joy: Joy, frameId: string): Joy {
  return {
    header: joyHeader(frameId),
    axes: Array.from(joy.axes),
    buttons: Array.from(joy.buttons),
  };
}

function neutralizeJoy(joy: Joy | undefined, frameId: string): Joy {
  return {
    header: joyHeader(frameId),
    axes: joy?.axes.map(() => 0) ?? [],
    buttons: joy?.buttons.map(() => 0) ?? [],
  };
}

function JoyPanel({ context }: { context: PanelExtensionContext }): JSX.Element {
  const [topics, setTopics] = useState<undefined | Immutable<Topic[]>>();
  const [messages, setMessages] = useState<undefined | Immutable<MessageEvent[]>>();
  const [joy, setJoy] = useState<Joy | undefined>();
  const [rawGamepad, setRawGamepad] = useState<RawGamepadState | undefined>();
  const advertisedTopicRef = useRef<string | undefined>();
  const [kbEnabled, setKbEnabled] = useState<boolean>(true);
  const [gamepadIds, setGamepadIds] = useState<number[]>(() => getConnectedGamepadIds());
  const panelRootRef = useRef<HTMLDivElement | null>(null);
  const prevDataSourceRef = useRef<string>();
  const [trackedKeys, setTrackedKeys] = useState<Map<string, KbMap> | undefined>(() => {
    const keyMap = new Map<string, KbMap>();

    for (const [key, value] of Object.entries(kbmapping1)) {
      const k: KbMap = {
        button: value.button,
        axis: value.axis,
        direction: value.direction === "+" ? 1 : 0,
        value: 0,
      };
      keyMap.set(keyToCode(key), k);
    }
    return keyMap;
  });

  const [renderDone, setRenderDone] = useState<(() => void) | undefined>();

  const [config, setConfig] = useState<Config>(() => {
    const partialConfig = context.initialState as Partial<Config>;
    partialConfig.subJoyTopic ??= "/joy";
    partialConfig.pubJoyTopic ??= "/joy";
    partialConfig.publishMode ??= false;
    partialConfig.publishFrameId ??= "";
    partialConfig.dataSource ??= "gamepad";
    partialConfig.controllerMappingId ??= defaultControllerMappingId;
    partialConfig.gamepadId ??= 0;
    if (partialConfig.dataSource === "sub-joy-topic") {
      partialConfig.publishMode = false;
    }
    return partialConfig as Config;
  });

  const resetTrackedKeys = useCallback((): Map<string, KbMap> | undefined => {
    if (!trackedKeys) {
      return trackedKeys;
    }

    const newKeys = new Map(trackedKeys);
    newKeys.forEach((value, key) => {
      newKeys.set(key, { ...value, value: 0 });
    });
    setTrackedKeys(newKeys);
    return newKeys;
  }, [trackedKeys]);

  const settingsActionHandler = useCallback(
    (action: SettingsTreeAction) => {
      setConfig((prevConfig) => settingsActionReducer(prevConfig, action));
    },
    [setConfig],
  );

  const refreshConnectedGamepads = useCallback(() => {
    setGamepadIds(getConnectedGamepadIds());
  }, []);

  const activeGamepadId = useMemo(() => {
    if (config.dataSource !== "gamepad" || gamepadIds.length === 0) {
      return undefined;
    }

    if (gamepadIds.includes(config.gamepadId)) {
      return config.gamepadId;
    }

    return gamepadIds[0];
  }, [config.dataSource, config.gamepadId, gamepadIds]);

  // Register the settings tree
  useEffect(() => {
    context.updatePanelSettingsEditor({
      actionHandler: settingsActionHandler,
      nodes: buildSettingsTree(config, topics, gamepadIds),
    });
  }, [config, context, gamepadIds, settingsActionHandler, topics]);

  // We use a layout effect to setup render handling for our panel. We also setup some topic subscriptions.
  useLayoutEffect(() => {
    // The render handler is run by the broader studio system during playback when your panel
    // needs to render because the fields it is watching have changed. How you handle rendering depends on your framework.
    // You can only setup one render handler - usually early on in setting up your panel.
    //
    // Without a render handler your panel will never receive updates.
    //
    // The render handler could be invoked as often as 60hz during playback if fields are changing often.
    context.onRender = (renderState, done) => {
      // render functions receive a _done_ callback. You MUST call this callback to indicate your panel has finished rendering.
      // Your panel will not receive another render callback until _done_ is called from a prior render. If your panel is not done
      // rendering before the next render call, studio shows a notification to the user that your panel is delayed.
      //
      // Set the done callback into a state variable to trigger a re-render.
      setRenderDone(() => done);

      // We may have new topics - since we are also watching for messages in the current frame, topics may not have changed
      // It is up to you to determine the correct action when state has not changed.
      setTopics(renderState.topics);

      // currentFrame has messages on subscribed topics since the last render call
      setMessages(renderState.currentFrame);
    };

    // After adding a render handler, you must indicate which fields from RenderState will trigger updates.
    // If you do not watch any fields then your panel will never render since the panel context will assume you do not want any updates.

    // tell the panel context that we care about any update to the _topic_ field of RenderState
    context.watch("topics");

    // tell the panel context we want messages for the current frame for topics we've subscribed to
    // This corresponds to the _currentFrame_ field of render state.
    context.watch("currentFrame");
  }, [context]);

  // Or subscribe to the relevant topic when in a recorded session
  useEffect(() => {
    if (config.dataSource === "sub-joy-topic") {
      context.subscribe([config.subJoyTopic]);
    } else {
      context.unsubscribeAll();
    }
  }, [config.subJoyTopic, context, config.dataSource]);

  // If subscribing
  useEffect(() => {
    const latestJoy = messages?.[messages.length - 1]?.message as Joy | undefined;
    if (latestJoy) {
      setJoy(copyJoyMessage(latestJoy, config.publishFrameId));
    }
  }, [messages, config.publishFrameId]);

  useGamepad({
    didConnect: useCallback((gp: Gamepad) => {
      refreshConnectedGamepads();
      console.log("Gamepad " + gp.index + " connected!");
    }, [refreshConnectedGamepads]),

    didDisconnect: useCallback(
      (gp: Gamepad) => {
        refreshConnectedGamepads();
        console.log("Gamepad " + gp.index + " discconnected!");

        if (activeGamepadId == undefined || activeGamepadId !== gp.index) {
          return;
        }

        setRawGamepad(undefined);
        const controllerMapping =
          getActiveControllerMapping(gp, config.controllerMappingId) ??
          getControllerMapping(config.controllerMappingId);
        setJoy(
          createNeutralJoy(controllerMapping, joyHeader(config.publishFrameId)),
        );
      },
      [activeGamepadId, config.controllerMappingId, config.publishFrameId, refreshConnectedGamepads],
    ),

    didUpdate: useCallback(
      (gp: Gamepad) => {
        if (activeGamepadId == undefined || activeGamepadId !== gp.index) {
          return;
        }

        setRawGamepad(snapshotGamepad(gp));
        const controllerMapping = getActiveControllerMapping(gp, config.controllerMappingId);
        if (!controllerMapping) {
          setJoy((prevJoy) => neutralizeJoy(prevJoy, config.publishFrameId));
          return;
        }

        const tmpJoy = joyFromGamepad(gp, controllerMapping, joyHeader(config.publishFrameId));

        setJoy(tmpJoy);
      },
      [activeGamepadId, config.controllerMappingId, config.publishFrameId],
    ),
    enabled: config.dataSource === "gamepad",
  });

  // Keyboard mode

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable)
    ) {
      return;
    }

    setTrackedKeys((oldTrackedKeys) => {
      if (oldTrackedKeys && oldTrackedKeys.has(event.code)) {
        const newKeys = new Map(oldTrackedKeys);
        const k = newKeys.get(event.code);
        if (k) {
          newKeys.set(event.code, { ...k, value: 1 });
        }
        return newKeys;
      }
      return oldTrackedKeys;
    });
  }, []);

  const handleKeyUp = useCallback((event: KeyboardEvent) => {
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable)
    ) {
      return;
    }

    setTrackedKeys((oldTrackedKeys) => {
      if (oldTrackedKeys && oldTrackedKeys.has(event.code)) {
        const newKeys = new Map(oldTrackedKeys);
        const k = newKeys.get(event.code);
        if (k) {
          newKeys.set(event.code, { ...k, value: 0 });
        }
        return newKeys;
      }
      return oldTrackedKeys;
    });
  }, []);

  // Key down Listener
  useEffect(() => {
    const panelRoot = panelRootRef.current;
    if (!panelRoot) {
      return;
    }

    panelRoot.addEventListener("keydown", handleKeyDown);
    return () => {
      panelRoot.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleKeyDown]);

  // Key up Listener
  useEffect(() => {
    const panelRoot = panelRootRef.current;
    if (!panelRoot) {
      return;
    }

    panelRoot.addEventListener("keyup", handleKeyUp);
    return () => {
      panelRoot.removeEventListener("keyup", handleKeyUp);
    };
  }, [handleKeyUp]);

  // Generate Joy from Keys
  useEffect(() => {
    if (config.dataSource !== "keyboard") {
      return;
    }
    if (!kbEnabled) {
      return;
    }

    if (trackedKeys) {
      setJoy(joyFromKeyboardMap(trackedKeys, config.publishFrameId));
    }
  }, [config.dataSource, trackedKeys, config.publishFrameId, kbEnabled]);

  useEffect(() => {
    const prevDataSource = prevDataSourceRef.current;
    prevDataSourceRef.current = config.dataSource;

    if (
      prevDataSource != undefined &&
      prevDataSource !== config.dataSource &&
      (prevDataSource === "keyboard" || prevDataSource === "interactive" || prevDataSource === "gamepad")
    ) {
      if (prevDataSource === "keyboard") {
        resetTrackedKeys();
      }
      setJoy((prevJoy) => neutralizeJoy(prevJoy, config.publishFrameId));
    }
  }, [config.dataSource, config.publishFrameId, resetTrackedKeys]);

  // Advertise the topic to publish
  useEffect(() => {
    const shouldPublish = config.publishMode && config.dataSource !== "sub-joy-topic";
    const oldTopic = advertisedTopicRef.current;

    if (oldTopic && (!shouldPublish || oldTopic !== config.pubJoyTopic)) {
      context.unadvertise?.(oldTopic);
      advertisedTopicRef.current = undefined;
    }

    if (shouldPublish && oldTopic !== config.pubJoyTopic) {
      context.advertise?.(config.pubJoyTopic, "sensor_msgs/msg/Joy");
      advertisedTopicRef.current = config.pubJoyTopic;
    }
  }, [config.dataSource, config.pubJoyTopic, config.publishMode, context]);

  // Publish the joy message
  useEffect(() => {
    if (!config.publishMode || config.dataSource === "sub-joy-topic" || joy == undefined) {
      return;
    }

    if (advertisedTopicRef.current === config.pubJoyTopic) {
      context.publish?.(config.pubJoyTopic, joy);
    }
  }, [context, config.dataSource, config.pubJoyTopic, config.publishMode, joy]);

  // Invoke the done callback once the render is complete
  useEffect(() => {
    renderDone?.();
  }, [renderDone]);

  const handleKbSwitch = (event: React.ChangeEvent<HTMLInputElement>) => {
    const isEnabled = event.target.checked;
    setKbEnabled(isEnabled);

    if (!isEnabled) {
      const newKeys = resetTrackedKeys();
      if (newKeys) {
        setJoy(joyFromKeyboardMap(newKeys, config.publishFrameId));
      }
    }
  };

  const handlePanelPointerDown = useCallback(() => {
    if (config.dataSource === "keyboard") {
      panelRootRef.current?.focus();
    }
  }, [config.dataSource]);

  const handlePanelBlur = useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
        return;
      }

      if (config.dataSource === "keyboard") {
        const newKeys = resetTrackedKeys();
        if (newKeys) {
          setJoy(joyFromKeyboardMap(newKeys, config.publishFrameId));
        }
      }
    },
    [config.dataSource, config.publishFrameId, resetTrackedKeys],
  );

  const interactiveCb = useCallback(
    (interactiveJoy: Joy) => {
      if (config.dataSource !== "interactive") {
        return;
      }
      setJoy({
        header: joyHeader(config.publishFrameId),
        axes: Array.from(interactiveJoy.axes),
        buttons: Array.from(interactiveJoy.buttons),
      });
    },
    [config.publishFrameId, config.dataSource],
  );

  useEffect(() => {
    context.saveState(config);
  }, [context, config]);

  useEffect(() => {
    return () => {
      if (advertisedTopicRef.current) {
        context.unadvertise?.(advertisedTopicRef.current);
      }
    };
  }, [context]);

  const showRawGamepadDebug =
    config.dataSource === "gamepad" && config.controllerMappingId === "gembird-wired-ps";
  const activeRawAxes =
    rawGamepad?.axes
      .map((value, index) => ({ index, value }))
      .filter(({ value }) => Math.abs(value) > 0.05) ?? [];
  const activeRawButtons =
    rawGamepad?.buttons
      .map((value, index) => ({ index, value }))
      .filter(({ value }) => value > 0.05) ?? [];

  return (
    <div
      ref={panelRootRef}
      tabIndex={config.dataSource === "keyboard" ? 0 : -1}
      onPointerDown={handlePanelPointerDown}
      onBlur={handlePanelBlur}
    >
      {config.dataSource === "keyboard" ? (
        <FormGroup>
          <FormControlLabel
            control={<Switch checked={kbEnabled} onChange={handleKbSwitch} />}
            label="Enable Keyboard"
          />
        </FormGroup>
      ) : null}
      <GamepadView
        joy={joy}
        cbInteractChange={interactiveCb}
        controllerMapping={getControllerMapping(config.controllerMappingId)}
      />
      {showRawGamepadDebug ? (
        <div style={{ color: "#ddd", fontFamily: "monospace", fontSize: 12, padding: 8 }}>
          <div>{rawGamepad?.id ?? "No gamepad data"}</div>
          <div>mapping: {rawGamepad?.mapping || "(none)"}</div>
          <div>
            axes:{" "}
            {activeRawAxes.length > 0
              ? activeRawAxes.map(({ index, value }) => `${index}:${value.toFixed(2)}`).join(" ")
              : "neutral"}
          </div>
          <div>
            buttons:{" "}
            {activeRawButtons.length > 0
              ? activeRawButtons.map(({ index, value }) => `${index}:${value.toFixed(2)}`).join(" ")
              : "none"}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function initJoyPanel(context: PanelExtensionContext): () => void {
  ReactDOM.render(<JoyPanel context={context} />, context.panelElement);

  // Return a function to run when the panel is removed
  return () => {
    ReactDOM.unmountComponentAtNode(context.panelElement);
  };
}
