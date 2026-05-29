import { MessageEvent, PanelExtensionContext, Time } from "@foxglove/extension";
import { ReactElement, useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

import fullAssemblyImage from "./fullAssemblyImage";

type Config = {
  namespace: string;
  systemInfoTopic: string;
  batteryStateTopic: string;
  batteryHealthTopic: string;
  fsmStateTopic: string;
  fsmStatusTopic: string;
  safetyStopTopic: string;
  safetyStatusTopic: string;
  wheelCommandTopic: string;
  toolCommandTopic: string;
  missionListService: string;
  missionExecuteService: string;
  missionEndService: string;
  missionIdToExecute: string;
  fsmRequestService: string;
  clearSafetyStopService: string;
  staleAfterSeconds: number;
  motionStaleAfterSeconds: number;
  motionDeadband: number;
};

type SystemState = {
  device_type?: string;
  robot_number?: number;
  temperature?: number;
  cpu_load?: number;
  cpu_idle?: number;
  memory_usage?: number;
  disk_usage?: number;
  conn_type?: string;
  is_wifi?: boolean;
  is_mobile?: boolean;
};

type BatteryState = {
  voltage?: number;
  current?: number;
  percentage?: number;
  power_supply_status?: number;
  temperature?: number;
  cell_voltage?: number[];
  cell_temperature?: number[];
};

type DiagnosticArray = {
  status?: DiagnosticStatus[];
};

type DiagnosticStatus = {
  level?: number;
  name?: string;
  message?: string;
  hardware_id?: string;
  values?: { key?: string; value?: string }[];
};

type FSMState = {
  current_state?: string;
  current_profile?: number;
};

type FSMStatus = {
  current_state?: string;
  current_lifecycle_state?: string;
  current_profile?: number;
  transitioning_to_profile?: number;
  transition_status?: string;
  last_requester?: string;
  last_request_priority?: number;
  effective_priority_gate?: number;
  priority_age_sec?: number;
  last_message?: string;
};

type SafetyStop = {
  sender?: string;
  reason?: string;
};

type Vector3 = {
  x?: number;
  y?: number;
  z?: number;
};

type Twist = {
  linear?: Vector3;
  angular?: Vector3;
};

type LatestMessage<T> = {
  message: T;
  receiveTimeMs: number;
};

type TopicState = {
  systemInfo?: LatestMessage<SystemState>;
  batteryState?: LatestMessage<BatteryState>;
  batteryHealth?: LatestMessage<DiagnosticArray>;
  fsmState?: LatestMessage<FSMState>;
  fsmStatus?: LatestMessage<FSMStatus>;
  safetyStop?: LatestMessage<SafetyStop>;
  safetyStatus?: LatestMessage<DiagnosticArray>;
  wheelCommand?: LatestMessage<Twist>;
  toolCommand?: LatestMessage<Twist>;
};

type SettingsTreeAction =
  | {
      action: "update";
      payload: {
        path: string[];
        value: unknown;
      };
    }
  | { action: string; payload?: unknown };

type SettingsTreeField = {
  label: string;
  input: "string" | "number" | "boolean" | "select";
  value: string | number | boolean;
  disabled?: boolean;
  options?: { label: string; value: string }[];
};

type SettingsTreeFields = Record<string, SettingsTreeField>;
type SettingsTreeNodes = Record<string, { label: string; fields: SettingsTreeFields }>;
type PanelSettingsEditor = {
  actionHandler: (action: SettingsTreeAction) => void;
  nodes: SettingsTreeNodes;
};
type PanelContextWithSettings = PanelExtensionContext & {
  updatePanelSettingsEditor: (editor: PanelSettingsEditor) => void;
};
type PanelContextWithServices = PanelExtensionContext & {
  callService?: (service: string, request: Record<string, unknown>) => Promise<unknown>;
};

type ServiceCallState = {
  name: string;
  status: "idle" | "pending" | "success" | "error";
  message?: string;
};

const DEFAULT_CONFIG: Config = {
  namespace: "/amr_sweeper",
  systemInfoTopic: "system_info",
  batteryStateTopic: "battery_state",
  batteryHealthTopic: "battery_health",
  fsmStateTopic: "fsm_state",
  fsmStatusTopic: "fsm_status",
  safetyStopTopic: "safety_msgs/stop",
  safetyStatusTopic: "safety_controller/status",
  wheelCommandTopic: "cmd_vel_sweep_wheels",
  toolCommandTopic: "cmd_vel_sweep_tools",
  missionListService: "list_executable_missions",
  missionExecuteService: "execute_mission",
  missionEndService: "end_mission",
  missionIdToExecute: "",
  fsmRequestService: "request_state",
  clearSafetyStopService: "amr_sweeper_safety_controller/reset_latched_stop",
  staleAfterSeconds: 20,
  motionStaleAfterSeconds: 1,
  motionDeadband: 0.01,
};

const FSM_STATE_COLORS: Record<string, string> = {
  INITIALIZING: "#60a5fa",
  IDLING: "#22c55e",
  RUNNING: "#f59e0b",
  CHARGING: "#38bdf8",
  FAULT: "#ef4444",
};

const DIAGNOSTIC_LEVELS: Record<number, { label: string; className: string }> = {
  0: { label: "OK", className: "ok" },
  1: { label: "WARN", className: "warn" },
  2: { label: "ERROR", className: "error" },
  3: { label: "STALE", className: "stale" },
};

function normalizeNamespace(namespace: string): string {
  const trimmed = namespace.trim();
  if (trimmed.length === 0 || trimmed === "/") {
    return "";
  }
  return `/${trimmed.replace(/^\/+|\/+$/gu, "")}`;
}

function resolveTopic(namespace: string, topic: string): string {
  const trimmed = topic.trim();
  if (trimmed.startsWith("/")) {
    return trimmed;
  }
  const ns = normalizeNamespace(namespace);
  return `${ns}/${trimmed.replace(/^\/+|\/+$/gu, "")}`;
}

function resolveService(namespace: string, service: string): string {
  return resolveTopic(namespace, service);
}

function timeToMs(time: Time | undefined): number | undefined {
  if (!time) {
    return undefined;
  }
  return time.sec * 1000 + time.nsec / 1e6;
}

function mergeConfig(initialState: unknown): Config {
  return {
    ...DEFAULT_CONFIG,
    ...(typeof initialState === "object" && initialState != undefined ? initialState : {}),
  };
}

function formatPercent(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value * 100)}%` : "—";
}

function formatNumber(value: unknown, digits = 1, suffix = ""): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value.toFixed(digits)}${suffix}`
    : "—";
}

function batteryStatusLabel(status: unknown): string {
  switch (status) {
    case 1:
      return "Charging";
    case 2:
      return "Discharging";
    case 3:
      return "Not charging";
    case 4:
      return "Full";
    default:
      return "Unknown";
  }
}

function latestSeverity(diagnostics?: LatestMessage<DiagnosticArray>): {
  level: number;
  label: string;
  className: string;
} {
  const level = Math.max(
    ...(diagnostics?.message.status ?? []).map((status) => status.level ?? 0),
    0,
  );
  const mapped = DIAGNOSTIC_LEVELS[level] ?? { label: `LEVEL ${level}`, className: "warn" };
  return { level, ...mapped };
}

function isStale(
  latest: LatestMessage<unknown> | undefined,
  nowMs: number,
  staleAfterSeconds: number,
): boolean {
  if (!latest) {
    return true;
  }
  return nowMs - latest.receiveTimeMs > staleAfterSeconds * 1000;
}

function ageLabel(latest: LatestMessage<unknown> | undefined, nowMs: number): string {
  if (!latest) {
    return "no data";
  }
  const ageSeconds = Math.max(0, (nowMs - latest.receiveTimeMs) / 1000);
  return `${ageSeconds.toFixed(1)}s ago`;
}

function buildSettingsTree(config: Config): SettingsTreeNodes {
  const topicFields: SettingsTreeFields = {
    namespace: { label: "Namespace", input: "string", value: config.namespace },
    systemInfoTopic: { label: "System info", input: "string", value: config.systemInfoTopic },
    batteryStateTopic: { label: "Battery state", input: "string", value: config.batteryStateTopic },
    batteryHealthTopic: {
      label: "Battery health",
      input: "string",
      value: config.batteryHealthTopic,
    },
    fsmStateTopic: { label: "FSM state", input: "string", value: config.fsmStateTopic },
    fsmStatusTopic: { label: "FSM status", input: "string", value: config.fsmStatusTopic },
    safetyStopTopic: { label: "Safety stop", input: "string", value: config.safetyStopTopic },
    safetyStatusTopic: { label: "Safety status", input: "string", value: config.safetyStatusTopic },
    wheelCommandTopic: { label: "Wheel command", input: "string", value: config.wheelCommandTopic },
    toolCommandTopic: { label: "Tool command", input: "string", value: config.toolCommandTopic },
    staleAfterSeconds: {
      label: "Stale after sec",
      input: "number",
      value: config.staleAfterSeconds,
    },
    motionStaleAfterSeconds: {
      label: "Motion stale sec",
      input: "number",
      value: config.motionStaleAfterSeconds,
    },
    motionDeadband: { label: "Motion deadband", input: "number", value: config.motionDeadband },
  };

  const serviceFields: SettingsTreeFields = {
    fsmRequestService: { label: "FSM request", input: "string", value: config.fsmRequestService },
    missionListService: {
      label: "List missions",
      input: "string",
      value: config.missionListService,
    },
    missionExecuteService: {
      label: "Execute mission",
      input: "string",
      value: config.missionExecuteService,
    },
    missionEndService: { label: "End mission", input: "string", value: config.missionEndService },
    missionIdToExecute: { label: "Mission ID", input: "string", value: config.missionIdToExecute },
    clearSafetyStopService: {
      label: "Clear safety stop",
      input: "string",
      value: config.clearSafetyStopService,
    },
  };

  return {
    topics: { label: "Topics", fields: topicFields },
    services: { label: "Services", fields: serviceFields },
  };
}

function isSettingsUpdateAction(
  action: SettingsTreeAction,
): action is Extract<SettingsTreeAction, { action: "update" }> {
  return action.action === "update";
}

function reduceSettingsAction(previous: Config, action: SettingsTreeAction): Config {
  if (!isSettingsUpdateAction(action)) {
    return previous;
  }
  const key = action.payload.path[action.payload.path.length - 1] as keyof Config | undefined;
  if (key == undefined || !(key in previous)) {
    return previous;
  }
  const value = action.payload.value;
  if (
    key === "staleAfterSeconds" ||
    key === "motionStaleAfterSeconds" ||
    key === "motionDeadband"
  ) {
    const numeric = typeof value === "number" ? value : Number(value);
    return {
      ...previous,
      [key]: Number.isFinite(numeric) && numeric >= 0 ? numeric : previous[key],
    };
  }
  if (typeof value === "string") {
    return { ...previous, [key]: value };
  }
  return previous;
}

function diagnosticValue(
  diagnostics: LatestMessage<DiagnosticArray> | undefined,
  key: string,
): string | undefined {
  for (const status of diagnostics?.message.status ?? []) {
    const value = status.values?.find((candidate) => candidate.key === key)?.value;
    if (value != undefined) {
      return value;
    }
  }
  return undefined;
}

function isSafetyStopLatched(diagnostics: LatestMessage<DiagnosticArray> | undefined): boolean {
  return diagnosticValue(diagnostics, "stop_active") === "true";
}

function twistWheelSpeeds(
  command: LatestMessage<Twist> | undefined,
  nowMs: number,
  config: Config,
): { left: number; right: number } {
  if (isStale(command, nowMs, config.motionStaleAfterSeconds)) {
    return { left: 0, right: 0 };
  }
  const linearX = command?.message.linear?.x ?? 0;
  const angularZ = command?.message.angular?.z ?? 0;
  return { left: linearX - angularZ, right: linearX + angularZ };
}

function twistToolSpeeds(
  command: LatestMessage<Twist> | undefined,
  nowMs: number,
  config: Config,
): { left: number; right: number } {
  if (isStale(command, nowMs, config.motionStaleAfterSeconds)) {
    return { left: 0, right: 0 };
  }
  const linearX = command?.message.linear?.x ?? 0;
  const angularZ = command?.message.angular?.z ?? 0;
  return { left: linearX - angularZ, right: linearX + angularZ };
}

function moving(value: number, deadband: number): boolean {
  return Math.abs(value) > deadband;
}

function WheelArrow({
  x,
  y,
  side,
  speed,
  deadband,
}: {
  x: number;
  y: number;
  side: "left" | "right";
  speed: number;
  deadband: number;
}): ReactElement | null {
  if (!moving(speed, deadband)) {
    return null;
  }
  const forward = speed > 0;
  const arrowX = side === "left" ? x - 34 : x + 34;
  const startY = forward ? y + 38 : y - 38;
  const endY = forward ? y - 38 : y + 38;
  return (
    <g className="motion-arrow wheel-arrow">
      <line x1={arrowX} y1={startY} x2={arrowX} y2={endY} />
      <polygon
        points={`${arrowX},${endY} ${arrowX - 8},${endY + (forward ? 14 : -14)} ${arrowX + 8},${endY + (forward ? 14 : -14)}`}
      />
    </g>
  );
}

function BrushArrow({
  cx,
  cy,
  speed,
  deadband,
}: {
  cx: number;
  cy: number;
  speed: number;
  deadband: number;
}): ReactElement | null {
  if (!moving(speed, deadband)) {
    return null;
  }
  const clockwise = speed > 0;
  const sweep = clockwise ? 1 : 0;
  const startX = cx + 47;
  const startY = cy - 4;
  const endX = clockwise ? cx - 28 : cx + 28;
  const endY = cy - 39;
  const head = clockwise
    ? `${endX},${endY} ${endX + 16},${endY - 3} ${endX + 6},${endY + 12}`
    : `${endX},${endY} ${endX - 15},${endY + 5} ${endX - 3},${endY + 15}`;
  return (
    <g className="motion-arrow brush-arrow">
      <path d={`M ${startX} ${startY} A 48 48 0 0 ${sweep} ${endX} ${endY}`} />
      <polygon points={head} />
      <text x={cx} y={cy - 60}>
        {clockwise ? "CW" : "CCW"}
      </text>
    </g>
  );
}

function RobotTopView({
  wheelSpeeds,
  toolSpeeds,
  safetyLatched,
  deadband,
}: {
  wheelSpeeds: { left: number; right: number };
  toolSpeeds: { left: number; right: number };
  safetyLatched: boolean;
  deadband: number;
}): ReactElement {
  return (
    <div className="robot-view-shell">
      <svg
        className="robot-view"
        viewBox="0 0 520 640"
        role="img"
        aria-label="AMR Sweeper top view"
      >
        <defs>
          <filter id="redGlow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="8" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="shadowFade" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="rgba(8,15,28,0.05)" />
            <stop offset="1" stopColor="rgba(8,15,28,0.28)" />
          </linearGradient>
        </defs>

        <image
          href={fullAssemblyImage}
          x="60"
          y="14"
          width="400"
          height="612"
          preserveAspectRatio="xMidYMid meet"
        />
        <rect className="view-shadow" x="54" y="12" width="412" height="616" rx="34" />
        <BrushArrow cx={129} cy={157} speed={toolSpeeds.left} deadband={deadband} />
        <BrushArrow cx={392} cy={157} speed={toolSpeeds.right} deadband={deadband} />
        <WheelArrow x={114} y={460} side="left" speed={wheelSpeeds.left} deadband={deadband} />
        <WheelArrow x={406} y={460} side="right" speed={wheelSpeeds.right} deadband={deadband} />

        <g
          className={safetyLatched ? "stop-button latched" : "stop-button"}
          filter={safetyLatched ? "url(#redGlow)" : undefined}
        >
          <rect x="216" y="284" width="88" height="44" rx="12" />
          <text x="260" y="297">
            STOP
          </text>
        </g>
      </svg>
    </div>
  );
}

function StatusPill({ label, tone = "neutral" }: { label: string; tone?: string }): ReactElement {
  return <span className={`status-pill ${tone}`}>{label}</span>;
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: string | number | undefined;
}): ReactElement {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value ?? "—"}</strong>
    </div>
  );
}

function ServiceControls({
  context,
  config,
  serviceState,
  setServiceState,
}: {
  context: PanelExtensionContext;
  config: Config;
  serviceState: ServiceCallState;
  setServiceState: (state: ServiceCallState) => void;
}): ReactElement {
  const callService = useCallback(
    async (name: string, request: Record<string, unknown>) => {
      const serviceName = resolveService(config.namespace, name);
      const serviceCaller = (context as PanelContextWithServices).callService;
      if (serviceCaller == undefined) {
        setServiceState({
          name: serviceName,
          status: "error",
          message: "This Foxglove connection does not expose service calls to extension panels.",
        });
        return;
      }
      setServiceState({ name: serviceName, status: "pending", message: "Waiting for response…" });
      try {
        const response = await serviceCaller(serviceName, request);
        setServiceState({
          name: serviceName,
          status: "success",
          message: JSON.stringify(response),
        });
      } catch (error) {
        setServiceState({
          name: serviceName,
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [config.namespace, context, setServiceState],
  );

  return (
    <section className="control-panel">
      <div className="section-heading">
        <h2>Controls</h2>
      </div>
      <div className="button-grid">
        <button
          onClick={() => {
            void callService(config.fsmRequestService, {
              target_state: "IDLING",
              target_lifecycle: "Active",
              target_profile_id: 101,
              requester: "foxglove_amr_sweeper_panel",
              priority: 100,
              force: false,
              reason: "Operator requested IDLING from Foxglove panel",
              mission_execution_directory: "",
            });
          }}
        >
          Request IDLING
        </button>
        <button
          className="danger"
          onClick={() => {
            void callService(config.fsmRequestService, {
              target_state: "FAULT",
              target_lifecycle: "Active",
              target_profile_id: 400,
              requester: "foxglove_amr_sweeper_panel",
              priority: 250,
              force: true,
              reason: "Operator requested FAULT from Foxglove panel",
              mission_execution_directory: "",
            });
          }}
        >
          Request FAULT
        </button>
        <button
          onClick={() => {
            void callService(config.fsmRequestService, {
              target_state: "CHARGING",
              target_lifecycle: "Active",
              target_profile_id: 301,
              requester: "foxglove_amr_sweeper_panel",
              priority: 100,
              force: false,
              reason: "Operator requested CHARGING from Foxglove panel",
              mission_execution_directory: "",
            });
          }}
        >
          Request CHARGING
        </button>
        <button
          onClick={() => {
            void callService(config.clearSafetyStopService, {});
          }}
        >
          Clear Safety Stop
        </button>
        <button
          onClick={() => {
            void callService(config.missionListService, {});
          }}
        >
          List Missions
        </button>
        <button
          disabled={config.missionIdToExecute.trim().length === 0}
          onClick={() => {
            void callService(config.missionExecuteService, {
              mission_id: config.missionIdToExecute.trim(),
              mission_execution_directory: "",
              mission_window_start: "",
              mission_window_end: "",
              requester: "foxglove_amr_sweeper_panel",
              priority: 100,
              force: false,
              reason: "Operator executed mission from Foxglove panel",
            });
          }}
        >
          Execute Mission
        </button>
        <button
          onClick={() => {
            void callService(config.missionEndService, {
              mission_id: "",
              reason: "Operator ended mission from Foxglove panel",
              outcome: "operator_aborted",
              requester: "foxglove_amr_sweeper_panel",
              priority: 200,
              force: true,
              request_idling: true,
            });
          }}
        >
          End Active Mission
        </button>
      </div>
      <div className={`service-result ${serviceState.status}`}>
        <strong>{serviceState.status.toUpperCase()}</strong>
        {serviceState.name && <span className="service-name">{serviceState.name}</span>}
        {serviceState.message && <code>{serviceState.message}</code>}
      </div>
    </section>
  );
}

function AmrSweeperPanel({ context }: { context: PanelExtensionContext }): ReactElement {
  const [config, setConfig] = useState<Config>(() => mergeConfig(context.initialState));
  const [topicState, setTopicState] = useState<TopicState>({});
  const [renderDone, setRenderDone] = useState<(() => void) | undefined>();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [useWallClock, setUseWallClock] = useState(true);
  const [serviceState, setServiceState] = useState<ServiceCallState>({ name: "", status: "idle" });

  const topics = useMemo(
    () => ({
      systemInfo: resolveTopic(config.namespace, config.systemInfoTopic),
      batteryState: resolveTopic(config.namespace, config.batteryStateTopic),
      batteryHealth: resolveTopic(config.namespace, config.batteryHealthTopic),
      fsmState: resolveTopic(config.namespace, config.fsmStateTopic),
      fsmStatus: resolveTopic(config.namespace, config.fsmStatusTopic),
      safetyStop: resolveTopic(config.namespace, config.safetyStopTopic),
      safetyStatus: resolveTopic(config.namespace, config.safetyStatusTopic),
      wheelCommand: resolveTopic(config.namespace, config.wheelCommandTopic),
      toolCommand: resolveTopic(config.namespace, config.toolCommandTopic),
    }),
    [config],
  );

  const settingsActionHandler = useCallback((action: SettingsTreeAction) => {
    setConfig((previous) => reduceSettingsAction(previous, action));
  }, []);

  useEffect(() => {
    const settingsContext = context as PanelContextWithSettings;
    context.saveState(config);
    settingsContext.updatePanelSettingsEditor({
      actionHandler: settingsActionHandler,
      nodes: buildSettingsTree(config),
    });
  }, [config, context, settingsActionHandler]);

  useEffect(() => {
    if (!useWallClock) {
      return undefined;
    }
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(interval);
    };
  }, [useWallClock]);

  useLayoutEffect(() => {
    context.onRender = (renderState, done) => {
      setRenderDone(() => done);
      const currentTimeMs = timeToMs(renderState.currentTime);
      setUseWallClock(currentTimeMs == undefined);
      const frameTimeMs = currentTimeMs ?? Date.now();
      setNowMs(frameTimeMs);
      if (renderState.didSeek === true) {
        setTopicState({});
      }
      const currentFrame = renderState.currentFrame ?? [];
      if (currentFrame.length > 0) {
        setTopicState((previous) => {
          const next = { ...previous };
          for (const event of currentFrame as readonly MessageEvent[]) {
            const receiveTimeMs = timeToMs(event.receiveTime) ?? frameTimeMs;
            const topic = event.topic;
            if (topic === topics.systemInfo) {
              next.systemInfo = { message: event.message as SystemState, receiveTimeMs };
            } else if (topic === topics.batteryState) {
              next.batteryState = { message: event.message as BatteryState, receiveTimeMs };
            } else if (topic === topics.batteryHealth) {
              next.batteryHealth = { message: event.message as DiagnosticArray, receiveTimeMs };
            } else if (topic === topics.fsmState) {
              next.fsmState = { message: event.message as FSMState, receiveTimeMs };
            } else if (topic === topics.fsmStatus) {
              next.fsmStatus = { message: event.message as FSMStatus, receiveTimeMs };
            } else if (topic === topics.safetyStop) {
              next.safetyStop = { message: event.message as SafetyStop, receiveTimeMs };
            } else if (topic === topics.safetyStatus) {
              next.safetyStatus = { message: event.message as DiagnosticArray, receiveTimeMs };
            } else if (topic === topics.wheelCommand) {
              next.wheelCommand = { message: event.message as Twist, receiveTimeMs };
            } else if (topic === topics.toolCommand) {
              next.toolCommand = { message: event.message as Twist, receiveTimeMs };
            }
          }
          return next;
        });
      }
    };

    context.watch("currentFrame");
    context.watch("currentTime");
    context.watch("didSeek");
    context.subscribe(Object.values(topics).map((topic) => ({ topic })));

    return () => {
      context.unsubscribeAll();
    };
  }, [context, topics]);

  useEffect(() => {
    renderDone?.();
  }, [renderDone]);

  const fsmStatusMessage = topicState.fsmStatus?.message;
  const fsmStateMessage = topicState.fsmState?.message;
  const fsm = fsmStatusMessage ?? fsmStateMessage;
  const fsmState = fsm?.current_state ?? "UNKNOWN";
  const fsmColor = FSM_STATE_COLORS[fsmState] ?? "#64748b";
  const safetySeverity = latestSeverity(topicState.safetyStatus);
  const batterySeverity = latestSeverity(topicState.batteryHealth);
  const safetyStatusIsStale = isStale(topicState.safetyStatus, nowMs, config.staleAfterSeconds);
  const safetyStopIsStale = isStale(topicState.safetyStop, nowMs, config.staleAfterSeconds);
  const safetyLatched = !safetyStatusIsStale && isSafetyStopLatched(topicState.safetyStatus);
  const hasSafetyStop = !safetyStopIsStale && topicState.safetyStop != undefined;
  const systemInfoIsStale = isStale(topicState.systemInfo, nowMs, config.staleAfterSeconds);
  const batteryIsStale = isStale(topicState.batteryState, nowMs, config.staleAfterSeconds);
  const fsmIsStale = isStale(
    topicState.fsmStatus ?? topicState.fsmState,
    nowMs,
    config.staleAfterSeconds,
  );

  return (
    <div className="amr-panel">
      <style>{STYLES}</style>
      <div className="panel-shell">
        <header className="hero">
          <div>
            <p>O-Robotics</p>
            <h1>AMR Sweeper Panel</h1>
          </div>
          <div className="hero-status" style={{ borderColor: fsmColor }}>
            <span style={{ background: fsmColor }} />
            <strong>{fsmState}</strong>
            <small>Profile {fsm?.current_profile ?? "—"}</small>
          </div>
        </header>

        <main className="dashboard">
          <section className="visual-panel">
            <RobotTopView
              wheelSpeeds={twistWheelSpeeds(topicState.wheelCommand, nowMs, config)}
              toolSpeeds={twistToolSpeeds(topicState.toolCommand, nowMs, config)}
              safetyLatched={safetyLatched}
              deadband={config.motionDeadband}
            />
            <div className="motion-legend">
              <StatusPill
                label={systemInfoIsStale ? "SYS STALE" : "SYS LIVE"}
                tone={systemInfoIsStale ? "stale" : "ok"}
              />
              <StatusPill label={batterySeverity.label} tone={batterySeverity.className} />
              <StatusPill label={safetySeverity.label} tone={safetySeverity.className} />
              <span>Wheel {ageLabel(topicState.wheelCommand, nowMs)}</span>
              <span>Tool {ageLabel(topicState.toolCommand, nowMs)}</span>
            </div>
          </section>

          <aside className="sidebar">
            <section className="info-section primary">
              <div className="section-heading">
                <h2>State</h2>
                <span>{ageLabel(topicState.fsmStatus ?? topicState.fsmState, nowMs)}</span>
              </div>
              <div className="pill-row">
                <StatusPill
                  label={fsmIsStale ? "FSM STALE" : "FSM LIVE"}
                  tone={fsmIsStale ? "stale" : "ok"}
                />
                <StatusPill
                  label={safetyLatched ? "SAFETY LATCHED" : "SAFETY READY"}
                  tone={safetyLatched ? "error" : "ok"}
                />
              </div>
              <Metric label="Lifecycle" value={fsmStatusMessage?.current_lifecycle_state} />
              <Metric label="Profile" value={fsm?.current_profile} />
              <Metric label="Requester" value={fsmStatusMessage?.last_requester} />
            </section>

            <section className="info-section">
              <div className="section-heading">
                <h2>Battery</h2>
                <span>{ageLabel(topicState.batteryState, nowMs)}</span>
              </div>
              <div className="pill-row">
                <StatusPill
                  label={batteryIsStale ? "STALE" : "LIVE"}
                  tone={batteryIsStale ? "stale" : "ok"}
                />
                <StatusPill
                  label={batteryStatusLabel(topicState.batteryState?.message.power_supply_status)}
                  tone="neutral"
                />
              </div>
              <Metric
                label="Charge"
                value={formatPercent(topicState.batteryState?.message.percentage)}
              />
              <Metric
                label="Voltage"
                value={formatNumber(topicState.batteryState?.message.voltage, 1, "V")}
              />
              <Metric
                label="Temp"
                value={formatNumber(topicState.batteryState?.message.temperature, 0, "°C")}
              />
            </section>

            <section className="info-section">
              <div className="section-heading">
                <h2>System</h2>
                <span>{ageLabel(topicState.systemInfo, nowMs)}</span>
              </div>
              <Metric label="Robot" value={topicState.systemInfo?.message.robot_number} />
              <Metric
                label="CPU"
                value={formatNumber(topicState.systemInfo?.message.cpu_load, 0, "%")}
              />
              <Metric
                label="Mem"
                value={formatNumber(topicState.systemInfo?.message.memory_usage, 0, "%")}
              />
              <Metric label="Conn" value={topicState.systemInfo?.message.conn_type} />
            </section>

            <section className="info-section safety">
              <div className="section-heading">
                <h2>Safety</h2>
                <span>{ageLabel(topicState.safetyStatus ?? topicState.safetyStop, nowMs)}</span>
              </div>
              <div className="pill-row">
                <StatusPill
                  label={hasSafetyStop ? "STOP SEEN" : "NO STOP"}
                  tone={hasSafetyStop ? "error" : "neutral"}
                />
                <StatusPill
                  label={safetyStatusIsStale ? "STALE" : "LIVE"}
                  tone={safetyStatusIsStale ? "stale" : "ok"}
                />
              </div>
              <Metric label="Sender" value={topicState.safetyStop?.message.sender} />
              <p className="message-box compact">
                {topicState.safetyStop?.message.reason ?? "No safety stop reason received."}
              </p>
            </section>

            <ServiceControls
              context={context}
              config={config}
              serviceState={serviceState}
              setServiceState={setServiceState}
            />
          </aside>
        </main>
      </div>
    </div>
  );
}

const STYLES = `
.amr-panel {
  align-items: center;
  display: flex;
  height: 100%;
  justify-content: center;
  min-height: 100%;
  overflow: hidden;
  padding: 8px;
  color: #e2e8f0;
  background: radial-gradient(circle at top, #0f2740 0%, #07101c 58%, #02070f 100%);
  font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.panel-shell {
  box-sizing: border-box;
  width: 650px;
  max-width: 650px;
  height: 400px;
  max-height: 400px;
  overflow: hidden;
  border: 1px solid #15314a;
  border-radius: 18px;
  background: rgba(3, 10, 20, 0.92);
  box-shadow: 0 16px 36px rgba(0, 0, 0, 0.38);
  padding: 10px;
}
.hero {
  align-items: center;
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
.hero p { color: #7cb6df; margin: 0 0 3px; text-transform: uppercase; letter-spacing: 0.16em; font-size: 9px; }
.hero h1 { margin: 0; font-size: 19px; line-height: 1.1; }
.hero-status { align-items: center; background: rgba(12, 22, 38, 0.95); border: 1px solid #334155; border-radius: 999px; display: flex; gap: 8px; padding: 7px 10px; }
.hero-status span { border-radius: 999px; display: block; height: 10px; width: 10px; }
.hero-status strong { font-size: 12px; }
.hero-status small { color: #94a3b8; font-size: 10px; }
.dashboard {
  display: grid;
  grid-template-columns: 418px 202px;
  gap: 10px;
  height: calc(100% - 48px);
}
.visual-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.sidebar {
  display: grid;
  grid-template-rows: repeat(4, minmax(0, auto)) 1fr;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
}
.info-section, .control-panel {
  background: rgba(10, 20, 34, 0.92);
  border: 1px solid #203449;
  border-radius: 12px;
  padding: 7px 8px;
  min-width: 0;
}
.info-section.primary {
  background: linear-gradient(180deg, rgba(16, 34, 56, 0.96), rgba(8, 18, 31, 0.96));
}
.section-heading {
  align-items: baseline;
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 5px;
}
.section-heading h2 {
  font-size: 11px;
  letter-spacing: 0.08em;
  margin: 0;
  text-transform: uppercase;
}
.section-heading span {
  color: #8ba5bd;
  font-size: 9px;
  white-space: nowrap;
}
.metric {
  align-items: center;
  border-top: 1px solid rgba(42, 61, 79, 0.85);
  display: flex;
  font-size: 10px;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 0 0;
  margin-top: 4px;
}
.metric span { color: #8fa8c2; }
.metric strong { font-size: 10px; text-align: right; }
.status-pill { border-radius: 999px; font-size: 9px; font-weight: 800; letter-spacing: 0.08em; padding: 3px 7px; width: max-content; }
.status-pill.ok { background: rgba(34,197,94,0.16); color: #86efac; }
.status-pill.warn { background: rgba(245,158,11,0.16); color: #fcd34d; }
.status-pill.error { background: rgba(239,68,68,0.18); color: #fca5a5; }
.status-pill.stale { background: rgba(148,163,184,0.16); color: #cbd5e1; }
.status-pill.neutral { background: rgba(59,130,246,0.14); color: #93c5fd; }
.pill-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.message-box {
  background: rgba(5, 13, 24, 0.85);
  border: 1px solid #1f2937;
  border-radius: 9px;
  color: #cbd5e1;
  margin: 4px 0 0;
  padding: 8px;
}
.message-box.compact {
  font-size: 10px;
  line-height: 1.25;
  max-height: 46px;
  overflow: hidden;
}
.button-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 5px;
}
button {
  background: linear-gradient(180deg, #2e7bf6, #1858c9);
  border: 0;
  border-radius: 8px;
  color: white;
  cursor: pointer;
  font-size: 10px;
  font-weight: 700;
  line-height: 1.15;
  min-height: 28px;
  padding: 5px 6px;
}
button:hover { background: linear-gradient(180deg, #3b89ff, #2064db); }
button:disabled { background: #475569; cursor: not-allowed; }
button.danger { background: linear-gradient(180deg, #dc2626, #b91c1c); }
button.danger:hover { background: linear-gradient(180deg, #ef4444, #dc2626); }
.service-result {
  background: rgba(5, 13, 24, 0.8);
  border: 1px solid #1f2937;
  border-radius: 9px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 6px;
  min-height: 42px;
  padding: 6px 7px;
}
.service-result code {
  color: #bfdbfe;
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 9px;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.service-name {
  color: #8ba5bd;
  font-size: 9px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.service-result.success strong { color: #86efac; }
.service-result.error strong { color: #fca5a5; }
.service-result.pending strong { color: #fcd34d; }

.robot-view-shell {
  align-items: center;
  background: radial-gradient(circle at top, rgba(17, 40, 65, 0.82), rgba(2, 7, 15, 0.94));
  border: 1px solid #1f2937;
  border-radius: 14px;
  display: flex;
  flex: 1;
  justify-content: center;
  min-height: 0;
  overflow: hidden;
  padding: 6px;
}
.robot-view { height: 100%; width: 100%; }
.view-shadow { fill: url(#shadowFade); stroke: rgba(107, 114, 128, 0.35); stroke-width: 3; }
.motion-arrow line, .motion-arrow path { fill: none; stroke: #38bdf8; stroke-linecap: round; stroke-width: 7; }
.motion-arrow polygon { fill: #38bdf8; stroke: none; }
.brush-arrow path { stroke: #f97316; }
.brush-arrow polygon { fill: #f97316; }
.brush-arrow text { fill: #fed7aa; font-size: 18px; font-weight: 800; text-anchor: middle; }
.stop-button rect { fill: rgba(248, 113, 113, 0.88); stroke: #ef4444; stroke-width: 3; }
.stop-button text { fill: #fff5f5; font-size: 24px; font-weight: 900; letter-spacing: 2px; text-anchor: middle; dominant-baseline: middle; }
.stop-button.latched rect { fill: #ff0000; stroke: #fecaca; stroke-width: 5; }
.stop-button.latched text { fill: #ffffff; }
.motion-legend {
  align-items: center;
  color: #94a3b8;
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  font-size: 9px;
  line-height: 1.2;
  min-height: 34px;
}
`;

export function initAmrSweeperPanel(context: PanelExtensionContext): () => void {
  const root = createRoot(context.panelElement);
  root.render(<AmrSweeperPanel context={context} />);

  return () => {
    root.unmount();
  };
}
