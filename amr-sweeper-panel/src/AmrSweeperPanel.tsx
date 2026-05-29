import { MessageEvent, PanelExtensionContext } from "@foxglove/extension";
import { ReactElement, useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

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
  updatePanelSettingsEditor?: (editor: PanelSettingsEditor) => void;
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

function mergeConfig(initialState: unknown): Config {
  return { ...DEFAULT_CONFIG, ...(typeof initialState === "object" && initialState != undefined ? initialState : {}) };
}

function formatPercent(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value * 100)}%` : "—";
}

function formatNumber(value: unknown, digits = 1, suffix = ""): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(digits)}${suffix}` : "—";
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

function latestSeverity(diagnostics?: LatestMessage<DiagnosticArray>): { level: number; label: string; className: string } {
  const level = Math.max(...(diagnostics?.message.status ?? []).map((status) => status.level ?? 0), 0);
  const mapped = DIAGNOSTIC_LEVELS[level] ?? { label: `LEVEL ${level}`, className: "warn" };
  return { level, ...mapped };
}

function isStale(latest: LatestMessage<unknown> | undefined, nowMs: number, staleAfterSeconds: number): boolean {
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
    batteryHealthTopic: { label: "Battery health", input: "string", value: config.batteryHealthTopic },
    fsmStateTopic: { label: "FSM state", input: "string", value: config.fsmStateTopic },
    fsmStatusTopic: { label: "FSM status", input: "string", value: config.fsmStatusTopic },
    safetyStopTopic: { label: "Safety stop", input: "string", value: config.safetyStopTopic },
    safetyStatusTopic: { label: "Safety status", input: "string", value: config.safetyStatusTopic },
    wheelCommandTopic: { label: "Wheel command", input: "string", value: config.wheelCommandTopic },
    toolCommandTopic: { label: "Tool command", input: "string", value: config.toolCommandTopic },
    staleAfterSeconds: { label: "Stale after sec", input: "number", value: config.staleAfterSeconds },
    motionStaleAfterSeconds: {
      label: "Motion stale sec",
      input: "number",
      value: config.motionStaleAfterSeconds,
    },
    motionDeadband: { label: "Motion deadband", input: "number", value: config.motionDeadband },
  };

  const serviceFields: SettingsTreeFields = {
    fsmRequestService: { label: "FSM request", input: "string", value: config.fsmRequestService },
    missionListService: { label: "List missions", input: "string", value: config.missionListService },
    missionExecuteService: { label: "Execute mission", input: "string", value: config.missionExecuteService },
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

function reduceSettingsAction(previous: Config, action: SettingsTreeAction): Config {
  if (action.action !== "update") {
    return previous;
  }
  const key = action.payload.path.at(-1) as keyof Config | undefined;
  if (key == undefined || !(key in previous)) {
    return previous;
  }
  const value = action.payload.value;
  if (key === "staleAfterSeconds" || key === "motionStaleAfterSeconds" || key === "motionDeadband") {
    const numeric = typeof value === "number" ? value : Number(value);
    return { ...previous, [key]: Number.isFinite(numeric) && numeric >= 0 ? numeric : previous[key] };
  }
  if (typeof value === "string") {
    return { ...previous, [key]: value };
  }
  return previous;
}


function diagnosticValue(diagnostics: LatestMessage<DiagnosticArray> | undefined, key: string): string | undefined {
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

function twistWheelSpeeds(command: LatestMessage<Twist> | undefined, nowMs: number, config: Config): { left: number; right: number } {
  if (isStale(command, nowMs, config.motionStaleAfterSeconds)) {
    return { left: 0, right: 0 };
  }
  const linearX = command?.message.linear?.x ?? 0;
  const angularZ = command?.message.angular?.z ?? 0;
  return { left: linearX - angularZ, right: linearX + angularZ };
}

function twistToolSpeeds(command: LatestMessage<Twist> | undefined, nowMs: number, config: Config): { left: number; right: number } {
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

function WheelArrow({ x, y, side, speed, deadband }: { x: number; y: number; side: "left" | "right"; speed: number; deadband: number }): ReactElement | null {
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
      <polygon points={`${arrowX},${endY} ${arrowX - 8},${endY + (forward ? 14 : -14)} ${arrowX + 8},${endY + (forward ? 14 : -14)}`} />
    </g>
  );
}

function BrushArrow({ cx, cy, speed, deadband }: { cx: number; cy: number; speed: number; deadband: number }): ReactElement | null {
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
      <text x={cx} y={cy - 60}>{clockwise ? "CW" : "CCW"}</text>
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
      <svg className="robot-view" viewBox="0 0 520 640" role="img" aria-label="AMR Sweeper top view">
        <defs>
          <filter id="redGlow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="8" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="bodyGradient" x1="0" x2="1">
            <stop offset="0" stopColor="#9ca3af" />
            <stop offset="0.5" stopColor="#d4d7e5" />
            <stop offset="1" stopColor="#9ca3af" />
          </linearGradient>
          <pattern id="tread" width="8" height="14" patternUnits="userSpaceOnUse">
            <rect width="8" height="14" fill="#facc15" />
            <rect y="1" width="8" height="2" fill="#fef08a" opacity="0.8" />
          </pattern>
        </defs>

        <g className="brush left-brush" transform="translate(122 165)">
          {Array.from({ length: 44 }).map((_, index) => (
            <line
              key={`left-bristle-${index}`}
              x1="0"
              y1="0"
              x2="0"
              y2="-78"
              transform={`rotate(${index * 8.2})`}
            />
          ))}
          <circle r="52" />
        </g>
        <g className="brush right-brush" transform="translate(398 165)">
          {Array.from({ length: 44 }).map((_, index) => (
            <line
              key={`right-bristle-${index}`}
              x1="0"
              y1="0"
              x2="0"
              y2="-78"
              transform={`rotate(${index * 8.2})`}
            />
          ))}
          <circle r="52" />
        </g>
        <BrushArrow cx={122} cy={165} speed={toolSpeeds.left} deadband={deadband} />
        <BrushArrow cx={398} cy={165} speed={toolSpeeds.right} deadband={deadband} />

        <path className="robot-body" d="M135 90 Q135 45 185 45 L335 45 Q385 45 385 90 L385 210 Q385 288 352 382 L337 520 Q332 575 282 592 L238 592 Q188 575 183 520 L168 382 Q135 288 135 210 Z" />
        <path className="center-panel" d="M230 48 L290 48 Q305 230 292 520 L228 520 Q215 230 230 48 Z" />

        <rect className="wheel left-wheel" x="86" y="360" width="56" height="142" rx="14" />
        <rect className="wheel right-wheel" x="378" y="360" width="56" height="142" rx="14" />
        <WheelArrow x={114} y={431} side="left" speed={wheelSpeeds.left} deadband={deadband} />
        <WheelArrow x={406} y={431} side="right" speed={wheelSpeeds.right} deadband={deadband} />

        <rect className="label-band" x="142" y="422" width="236" height="58" />
        <circle className="center-cap" cx="260" cy="451" r="32" />
        <rect className="yellow-marker" x="214" y="498" width="16" height="48" rx="8" />
        <rect className="yellow-marker" x="290" y="498" width="16" height="48" rx="8" />

        <g className={safetyLatched ? "stop-button latched" : "stop-button"} filter={safetyLatched ? "url(#redGlow)" : undefined}>
          <rect x="216" y="268" width="88" height="44" rx="12" />
          <text x="260" y="297">STOP</text>
        </g>

        <text className="robot-caption" x="260" y="625">Wheel arrows: forward/backward · Brush arrows: CW/CCW · STOP glows when latched</text>
      </svg>
    </div>
  );
}

function StatusPill({ label, tone = "neutral" }: { label: string; tone?: string }): ReactElement {
  return <span className={`status-pill ${tone}`}>{label}</span>;
}

function Card({ title, children, footer }: { title: string; children: ReactElement | ReactElement[]; footer?: string }): ReactElement {
  return (
    <section className="card">
      <h2>{title}</h2>
      <div className="card-body">{children}</div>
      {footer != undefined && <div className="card-footer">Updated {footer}</div>}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string | number | undefined }): ReactElement {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value ?? "—"}</strong>
    </div>
  );
}

function DiagnosticsSummary({ diagnostics }: { diagnostics?: LatestMessage<DiagnosticArray> }): ReactElement {
  const severity = latestSeverity(diagnostics);
  const statuses = diagnostics?.message.status ?? [];
  return (
    <div className="diagnostics">
      <StatusPill label={severity.label} tone={severity.className} />
      {statuses.slice(0, 3).map((status, index) => (
        <div className="diagnostic-row" key={`${status.name ?? "diagnostic"}-${index}`}>
          <span>{status.name ?? "diagnostic"}</span>
          <strong>{status.message ?? DIAGNOSTIC_LEVELS[status.level ?? 0]?.label ?? "—"}</strong>
        </div>
      ))}
      {statuses.length === 0 && <p className="muted">No diagnostic messages received.</p>}
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
        setServiceState({ name: serviceName, status: "success", message: JSON.stringify(response) });
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
    <Card title="Operator Controls">
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
        {serviceState.name && <span>{serviceState.name}</span>}
        {serviceState.message && <code>{serviceState.message}</code>}
      </div>
    </Card>
  );
}

function AmrSweeperPanel({ context }: { context: PanelExtensionContext }): ReactElement {
  const [config, setConfig] = useState<Config>(() => mergeConfig(context.initialState));
  const [topicState, setTopicState] = useState<TopicState>({});
  const [renderDone, setRenderDone] = useState<(() => void) | undefined>();
  const [nowMs, setNowMs] = useState(() => Date.now());
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
    context.saveState(config);
    (context as PanelContextWithSettings).updatePanelSettingsEditor?.({
      actionHandler: settingsActionHandler,
      nodes: buildSettingsTree(config),
    });
  }, [config, context, settingsActionHandler]);

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useLayoutEffect(() => {
    context.onRender = (renderState, done) => {
      setRenderDone(() => done);
      const receivedAt = Date.now();
      const currentFrame = renderState.currentFrame ?? [];
      if (currentFrame.length > 0) {
        setTopicState((previous) => {
          const next = { ...previous };
          for (const event of currentFrame as readonly MessageEvent[]) {
            const topic = event.topic;
            if (topic === topics.systemInfo) {
              next.systemInfo = { message: event.message as SystemState, receiveTimeMs: receivedAt };
            } else if (topic === topics.batteryState) {
              next.batteryState = { message: event.message as BatteryState, receiveTimeMs: receivedAt };
            } else if (topic === topics.batteryHealth) {
              next.batteryHealth = { message: event.message as DiagnosticArray, receiveTimeMs: receivedAt };
            } else if (topic === topics.fsmState) {
              next.fsmState = { message: event.message as FSMState, receiveTimeMs: receivedAt };
            } else if (topic === topics.fsmStatus) {
              next.fsmStatus = { message: event.message as FSMStatus, receiveTimeMs: receivedAt };
            } else if (topic === topics.safetyStop) {
              next.safetyStop = { message: event.message as SafetyStop, receiveTimeMs: receivedAt };
            } else if (topic === topics.safetyStatus) {
              next.safetyStatus = { message: event.message as DiagnosticArray, receiveTimeMs: receivedAt };
            } else if (topic === topics.wheelCommand) {
              next.wheelCommand = { message: event.message as Twist, receiveTimeMs: receivedAt };
            } else if (topic === topics.toolCommand) {
              next.toolCommand = { message: event.message as Twist, receiveTimeMs: receivedAt };
            }
          }
          return next;
        });
      }
    };

    context.watch("currentFrame");
    context.subscribe(Object.values(topics).map((topic) => ({ topic })));

    return () => {
      context.unsubscribeAll();
    };
  }, [context, topics]);

  useEffect(() => {
    renderDone?.();
  }, [renderDone]);

  const fsm = topicState.fsmStatus?.message ?? topicState.fsmState?.message;
  const fsmState = fsm.current_state ?? "UNKNOWN";
  const fsmColor = FSM_STATE_COLORS[fsmState] ?? "#64748b";
  const safetySeverity = latestSeverity(topicState.safetyStatus);
  const batterySeverity = latestSeverity(topicState.batteryHealth);
  const safetyLatched = isSafetyStopLatched(topicState.safetyStatus);
  const hasSafetyStop = topicState.safetyStop != undefined;

  return (
    <div className="amr-panel">
      <style>{STYLES}</style>
      <header className="hero">
        <div>
          <p>O-Robotics</p>
          <h1>AMR Sweeper Panel</h1>
        </div>
        <div className="hero-status" style={{ borderColor: fsmColor }}>
          <span style={{ background: fsmColor }} />
          <strong>{fsmState}</strong>
          <small>Profile {fsm.current_profile ?? "—"}</small>
        </div>
      </header>

      <main className="grid">
        <Card title="Robot Motion">
          <RobotTopView
            wheelSpeeds={twistWheelSpeeds(topicState.wheelCommand, nowMs, config)}
            toolSpeeds={twistToolSpeeds(topicState.toolCommand, nowMs, config)}
            safetyLatched={safetyLatched}
            deadband={config.motionDeadband}
          />
          <div className="motion-legend">
            <StatusPill
              label={safetyLatched ? "SAFETY STOP LATCHED" : "SAFETY READY"}
              tone={safetyLatched ? "error" : "ok"}
            />
            <span>Wheel cmd: {ageLabel(topicState.wheelCommand, nowMs)}</span>
            <span>Tool cmd: {ageLabel(topicState.toolCommand, nowMs)}</span>
          </div>
        </Card>

        <Card title="System Info" footer={ageLabel(topicState.systemInfo, nowMs)}>
          <div className="stale-row">
            <StatusPill
              label={isStale(topicState.systemInfo, nowMs, config.staleAfterSeconds) ? "STALE" : "LIVE"}
              tone={isStale(topicState.systemInfo, nowMs, config.staleAfterSeconds) ? "stale" : "ok"}
            />
          </div>
          <Metric label="Device" value={topicState.systemInfo?.message.device_type} />
          <Metric label="Robot #" value={topicState.systemInfo?.message.robot_number} />
          <Metric label="Temperature" value={formatNumber(topicState.systemInfo?.message.temperature, 0, "°C")} />
          <Metric label="CPU load" value={formatNumber(topicState.systemInfo?.message.cpu_load, 0, "%")} />
          <Metric label="CPU idle" value={formatNumber(topicState.systemInfo?.message.cpu_idle, 0, "%")} />
          <Metric label="Memory" value={formatNumber(topicState.systemInfo?.message.memory_usage, 0, "%")} />
          <Metric label="Disk" value={formatNumber(topicState.systemInfo?.message.disk_usage, 0, "%")} />
          <Metric label="Connection" value={topicState.systemInfo?.message.conn_type} />
          <Metric label="Wi-Fi / Mobile" value={`${topicState.systemInfo?.message.is_wifi ? "Wi-Fi" : "—"} / ${topicState.systemInfo?.message.is_mobile ? "Mobile" : "—"}`} />
        </Card>

        <Card title="Battery" footer={ageLabel(topicState.batteryState, nowMs)}>
          <div className="stale-row">
            <StatusPill label={batterySeverity.label} tone={batterySeverity.className} />
            <StatusPill
              label={isStale(topicState.batteryState, nowMs, config.staleAfterSeconds) ? "STALE" : "LIVE"}
              tone={isStale(topicState.batteryState, nowMs, config.staleAfterSeconds) ? "stale" : "ok"}
            />
          </div>
          <Metric label="Charge" value={formatPercent(topicState.batteryState?.message.percentage)} />
          <Metric label="Voltage" value={formatNumber(topicState.batteryState?.message.voltage, 2, " V")} />
          <Metric label="Current" value={formatNumber(topicState.batteryState?.message.current, 2, " A")} />
          <Metric label="State" value={batteryStatusLabel(topicState.batteryState?.message.power_supply_status)} />
          <Metric label="Max temp" value={formatNumber(topicState.batteryState?.message.temperature, 1, "°C")} />
          <Metric label="Cells" value={topicState.batteryState?.message.cell_voltage?.length ?? "—"} />
          <DiagnosticsSummary diagnostics={topicState.batteryHealth} />
        </Card>

        <Card title="FSM Supervisor" footer={ageLabel(topicState.fsmStatus ?? topicState.fsmState, nowMs)}>
          <div className="stale-row">
            <StatusPill
              label={isStale(topicState.fsmStatus ?? topicState.fsmState, nowMs, config.staleAfterSeconds) ? "STALE" : "LIVE"}
              tone={isStale(topicState.fsmStatus ?? topicState.fsmState, nowMs, config.staleAfterSeconds) ? "stale" : "ok"}
            />
          </div>
          <Metric label="State" value={fsmState} />
          <Metric label="Lifecycle" value={(fsm as FSMStatus).current_lifecycle_state} />
          <Metric label="Current profile" value={fsm.current_profile} />
          <Metric label="Transition profile" value={(fsm as FSMStatus).transitioning_to_profile} />
          <Metric label="Transition" value={(fsm as FSMStatus).transition_status} />
          <Metric label="Requester" value={(fsm as FSMStatus).last_requester} />
          <Metric label="Priority" value={(fsm as FSMStatus).last_request_priority} />
          <Metric label="Priority gate" value={(fsm as FSMStatus).effective_priority_gate} />
          <Metric label="Priority age" value={formatNumber((fsm as FSMStatus).priority_age_sec, 1, "s")} />
          <p className="message-box">{(fsm as FSMStatus).last_message ?? "No FSM status message received."}</p>
        </Card>

        <Card title="Safety" footer={ageLabel(topicState.safetyStatus ?? topicState.safetyStop, nowMs)}>
          <div className="stale-row">
            <StatusPill label={hasSafetyStop ? "STOP SEEN" : "NO STOP MSG"} tone={hasSafetyStop ? "error" : "neutral"} />
            <StatusPill label={safetySeverity.label} tone={safetySeverity.className} />
          </div>
          <Metric label="Last sender" value={topicState.safetyStop?.message.sender} />
          <p className="message-box">{topicState.safetyStop?.message.reason ?? "No safety stop reason received."}</p>
          <DiagnosticsSummary diagnostics={topicState.safetyStatus} />
        </Card>

        <ServiceControls
          context={context}
          config={config}
          serviceState={serviceState}
          setServiceState={setServiceState}
        />

        <Card title="Configured Interfaces">
          <div className="topic-list">
            {Object.entries(topics).map(([label, topic]) => (
              <div key={label}>
                <span>{label}</span>
                <code>{topic}</code>
              </div>
            ))}
          </div>
        </Card>
      </main>
    </div>
  );
}

const STYLES = `
.amr-panel {
  min-height: 100%;
  padding: 16px;
  color: #e2e8f0;
  background: #0f172a;
  font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.hero {
  align-items: center;
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}
.hero p { color: #94a3b8; margin: 0 0 4px; text-transform: uppercase; letter-spacing: 0.18em; font-size: 11px; }
.hero h1 { margin: 0; font-size: 28px; }
.hero-status { align-items: center; background: #111827; border: 1px solid #334155; border-radius: 999px; display: flex; gap: 10px; padding: 10px 14px; }
.hero-status span { border-radius: 999px; display: block; height: 12px; width: 12px; }
.hero-status small { color: #94a3b8; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 14px; }
.card { background: #111827; border: 1px solid #1f2937; border-radius: 16px; padding: 14px; box-shadow: 0 12px 28px rgba(0,0,0,0.24); }
.card h2 { font-size: 16px; margin: 0 0 12px; }
.card-body { display: flex; flex-direction: column; gap: 8px; }
.card-footer { color: #94a3b8; font-size: 12px; margin-top: 12px; }
.metric, .diagnostic-row, .topic-list div { align-items: center; border-bottom: 1px solid #1f2937; display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; }
.metric span, .diagnostic-row span, .topic-list span { color: #94a3b8; }
.metric strong, .diagnostic-row strong { text-align: right; }
.status-pill { border-radius: 999px; font-size: 11px; font-weight: 800; letter-spacing: 0.08em; padding: 4px 8px; width: max-content; }
.status-pill.ok { background: rgba(34,197,94,0.16); color: #86efac; }
.status-pill.warn { background: rgba(245,158,11,0.16); color: #fcd34d; }
.status-pill.error { background: rgba(239,68,68,0.18); color: #fca5a5; }
.status-pill.stale { background: rgba(148,163,184,0.16); color: #cbd5e1; }
.status-pill.neutral { background: rgba(59,130,246,0.14); color: #93c5fd; }
.stale-row { display: flex; gap: 8px; flex-wrap: wrap; }
.message-box { background: #0f172a; border: 1px solid #1f2937; border-radius: 10px; color: #cbd5e1; margin: 4px 0 0; padding: 10px; }
.muted { color: #94a3b8; margin: 0; }
.button-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; }
button { background: #2563eb; border: 0; border-radius: 10px; color: white; cursor: pointer; font-weight: 700; padding: 10px 12px; }
button:hover { background: #1d4ed8; }
button:disabled { background: #475569; cursor: not-allowed; }
button.danger { background: #dc2626; }
button.danger:hover { background: #b91c1c; }
.service-result { background: #0f172a; border: 1px solid #1f2937; border-radius: 10px; display: flex; flex-direction: column; gap: 6px; margin-top: 8px; padding: 10px; }
.service-result code, .topic-list code { color: #bfdbfe; font-family: "SFMono-Regular", Consolas, monospace; font-size: 12px; overflow-wrap: anywhere; }
.service-result.success strong { color: #86efac; }
.service-result.error strong { color: #fca5a5; }
.service-result.pending strong { color: #fcd34d; }
.diagnostics { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }

.robot-view-shell { align-items: center; background: #020617; border: 1px solid #1f2937; border-radius: 14px; display: flex; justify-content: center; overflow: hidden; padding: 10px; }
.robot-view { max-height: 520px; width: 100%; }
.robot-body { fill: url(#bodyGradient); stroke: #6b7280; stroke-width: 5; }
.center-panel { fill: rgba(226,232,240,0.34); stroke: none; }
.wheel { fill: url(#tread); stroke: #fde047; stroke-width: 5; }
.brush line { stroke: #dc2626; stroke-linecap: round; stroke-width: 3; }
.brush circle { fill: rgba(127,29,29,0.2); stroke: rgba(220,38,38,0.7); stroke-width: 2; }
.motion-arrow line, .motion-arrow path { fill: none; stroke: #38bdf8; stroke-linecap: round; stroke-width: 7; }
.motion-arrow polygon { fill: #38bdf8; stroke: none; }
.brush-arrow path { stroke: #f97316; }
.brush-arrow polygon { fill: #f97316; }
.brush-arrow text { fill: #fed7aa; font-size: 18px; font-weight: 800; text-anchor: middle; }
.label-band { fill: #334155; opacity: 0.82; }
.center-cap { fill: #9ca3af; stroke: #334155; stroke-width: 4; }
.yellow-marker { fill: #fde047; }
.stop-button rect { fill: #f87171; stroke: #ef4444; stroke-width: 3; }
.stop-button text { fill: #991b1b; font-size: 24px; font-weight: 900; letter-spacing: 2px; text-anchor: middle; }
.stop-button.latched rect { fill: #ff0000; stroke: #fecaca; stroke-width: 5; }
.stop-button.latched text { fill: #ffffff; }
.robot-caption { fill: #94a3b8; font-size: 13px; text-anchor: middle; }
.motion-legend { align-items: center; color: #94a3b8; display: flex; flex-wrap: wrap; gap: 10px; }
`;

export function initAmrSweeperPanel(context: PanelExtensionContext): () => void {
  const root = createRoot(context.panelElement);
  root.render(<AmrSweeperPanel context={context} />);

  return () => {
    root.unmount();
  };
}
