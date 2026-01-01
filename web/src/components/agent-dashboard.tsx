"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";

type AgentStatus = "idle" | "running" | "paused" | "success" | "stopped";
type AgentLogType =
  | "analysis"
  | "plan"
  | "action"
  | "observation"
  | "evaluation"
  | "decision";

type StepSource = "loop" | "manual";

interface AgentLog {
  id: string;
  type: AgentLogType;
  iteration: number;
  content: string;
  timestamp: number;
  subgoalId?: string;
}

interface Subgoal {
  id: string;
  description: string;
  status: "pending" | "active" | "completed" | "blocked";
  progress: number;
  attempts: number;
  idleCounter: number;
  notes?: string;
  lastUpdated: number;
}

interface AgentConfig {
  maxIterations: number;
  allowAssumptions: boolean;
  maxIdleIterations: number;
}

interface AgentState {
  goal: string;
  normalizedGoal: string;
  status: AgentStatus;
  iteration: number;
  subgoals: Subgoal[];
  logs: AgentLog[];
  assumptions: string[];
  config: AgentConfig;
  startedAt?: number;
  completedAt?: number;
  stagnationCounter: number;
}

interface Strategy {
  id: string;
  label: string;
  keywords: string[];
  actions: string[];
  evaluation: string;
  defaultFocus: string;
}

interface ActionPlan {
  label: string;
  summary: string;
  actions: string[];
  focus: string;
  evaluation: string;
  assumption?: string;
}

interface ExecutionOutcome {
  updatedSubgoal: Subgoal;
  actionDescription: string;
  observation: string;
  evaluation: string;
  decision: string;
  progressDelta: number;
  terminalStatus?: AgentStatus;
}

type AgentAction =
  | { type: "BOOT"; goal: string }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "RESET"; goal?: string }
  | { type: "STEP"; source: StepSource }
  | { type: "UPDATE_CONFIG"; config: Partial<AgentConfig> };

const TAG_STYLES: Record<AgentLogType, string> = {
  analysis:
    "border-sky-500/30 bg-sky-500/10 text-sky-100 shadow-[0_0_20px_rgba(14,165,233,0.05)]",
  plan:
    "border-indigo-500/30 bg-indigo-500/10 text-indigo-100 shadow-[0_0_20px_rgba(99,102,241,0.05)]",
  action:
    "border-emerald-500/30 bg-emerald-500/10 text-emerald-100 shadow-[0_0_20px_rgba(34,197,94,0.05)]",
  observation:
    "border-amber-500/30 bg-amber-500/10 text-amber-100 shadow-[0_0_20px_rgba(245,158,11,0.05)]",
  evaluation:
    "border-purple-500/30 bg-purple-500/10 text-purple-100 shadow-[0_0_20px_rgba(168,85,247,0.05)]",
  decision:
    "border-rose-500/30 bg-rose-500/10 text-rose-100 shadow-[0_0_20px_rgba(244,63,94,0.05)]",
};

const STATUS_LABEL: Record<AgentStatus, { label: string; tone: string }> = {
  idle: { label: "Idle", tone: "text-slate-300 border-slate-500/50" },
  running: { label: "Running", tone: "text-emerald-200 border-emerald-500/60" },
  paused: { label: "Paused", tone: "text-amber-200 border-amber-500/60" },
  success: { label: "Complete", tone: "text-sky-200 border-sky-500/60" },
  stopped: { label: "Stopped", tone: "text-rose-200 border-rose-500/60" },
};

const STRATEGY_LIBRARY: Strategy[] = [
  {
    id: "research",
    label: "Research & Synthesis",
    keywords: [
      "research",
      "investig",
      "analy",
      "study",
      "understand",
      "learn",
      "explore",
      "assessment",
    ],
    actions: [
      "Clarify the specific questions that must be answered",
      "Collect reputable sources and capture structured notes",
      "Synthesize findings into actionable insights",
    ],
    evaluation: "Confirm that knowledge gaps are closed and insights map to the goal.",
    defaultFocus: "Launch structured research sprint",
  },
  {
    id: "strategy",
    label: "Strategy Design",
    keywords: ["plan", "strategy", "roadmap", "framework", "approach", "design"],
    actions: [
      "Define decision criteria and guiding constraints",
      "Generate multiple strategic options with trade-offs",
      "Select the highest-leverage path and outline milestones",
    ],
    evaluation: "Ensure chosen strategy satisfies constraints and maximizes impact.",
    defaultFocus: "Craft a resilient strategic frame",
  },
  {
    id: "content",
    label: "Content Production",
    keywords: ["write", "content", "draft", "blog", "article", "copy", "documentation"],
    actions: [
      "Outline the narrative structure and key talking points",
      "Draft high-clarity copy with supporting evidence",
      "Revise for accuracy, tone, and actionable guidance",
    ],
    evaluation: "Validate clarity, coherence, and alignment with audience needs.",
    defaultFocus: "Develop a compelling narrative",
  },
  {
    id: "execution",
    label: "Operational Execution",
    keywords: ["implement", "build", "launch", "execute", "deploy", "deliver"],
    actions: [
      "Break work into concrete deliverables with owners",
      "Sequence tasks by impact and dependencies",
      "Execute the highest-leverage task and capture learnings",
    ],
    evaluation: "Verify deliverable readiness and unblock downstream tasks.",
    defaultFocus: "Drive tangible operational progress",
  },
  {
    id: "analysis",
    label: "Data Analysis",
    keywords: ["data", "metric", "forecast", "model", "quantit", "analyz"],
    actions: [
      "Validate data sources and quality constraints",
      "Run the analysis with documented methodology",
      "Summarize insights with clear implications",
    ],
    evaluation: "Check that insights are statistically sound and decision-ready.",
    defaultFocus: "Interrogate the data for signal",
  },
];

const DEFAULT_STRATEGY: Strategy = {
  id: "general",
  label: "Adaptive Problem Solving",
  keywords: [],
  actions: [
    "Clarify the desired outcome and success measures",
    "Identify the next reversible, high-leverage action",
    "Execute while capturing evidence for learning",
  ],
  evaluation: "Confirm measurable movement toward the outcome; adapt if blocked.",
  defaultFocus: "Find the highest-leverage move",
};

const INITIAL_CONFIG: AgentConfig = {
  maxIterations: 24,
  allowAssumptions: true,
  maxIdleIterations: 3,
};

let idCounter = 0;

function createId(prefix: string) {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

function normalizeGoal(goal: string) {
  return goal
    .replace(/\s+/g, " ")
    .replace(/\s\./g, ".")
    .trim();
}

function createSubgoals(goal: string): Subgoal[] {
  if (!goal) {
    return [];
  }

  const sentences = goal
    .split(/\n+/)
    .flatMap((line) =>
      line
        .split(/(?:(?:\.|;)|\bthen\b|\band\b|\bafter\b|\bnext\b)/i)
        .map((item) => item.trim())
        .filter(Boolean),
    );

  const uniqueSentences = Array.from(
    new Set(
      sentences.length > 0 ? sentences : [goal],
    ),
  );

  return uniqueSentences.map((description) => ({
    id: createId("subgoal"),
    description,
    status: "pending",
    progress: 0,
    attempts: 0,
    idleCounter: 0,
    notes: "",
    lastUpdated: Date.now(),
  }));
}

function deriveAssumptions(goal: string): string[] {
  const assumptions: string[] = [];
  const lower = goal.toLowerCase();

  if (/increase|grow|improve|boost/.test(lower) && !/by\s+\d|percent|%/.test(lower)) {
    assumptions.push(
      "Assuming a meaningful improvement target is any measurable uplift over the current baseline.",
    );
  }

  if (/customer|user|client/.test(lower) && !/segment|persona/.test(lower)) {
    assumptions.push(
      "Assuming a primary audience of engaged customers with access to historical interaction data.",
    );
  }

  if (/launch|deploy|deliver/.test(lower) && !/deadline|date|timeline/.test(lower)) {
    assumptions.push(
      "Assuming the deadline is within the current quarter, prioritizing actions that fit this window.",
    );
  }

  if (assumptions.length === 0) {
    assumptions.push(
      "Proceeding with an adaptive plan that will request clarification only if critical blockers appear.",
    );
  }

  return assumptions;
}

function selectStrategy(description: string): Strategy {
  const lower = description.toLowerCase();
  for (const strategy of STRATEGY_LIBRARY) {
    if (strategy.keywords.some((keyword) => lower.includes(keyword))) {
      return strategy;
    }
  }
  return DEFAULT_STRATEGY;
}

function craftActionPlan(subgoal: Subgoal, context: AgentState): ActionPlan {
  const strategy = selectStrategy(subgoal.description);
  const focus = strategy.defaultFocus;
  const actions = strategy.actions;
  const summary = `${strategy.label}: ${actions
    .slice(0, 3)
    .map((action, index) => `${index + 1}. ${action}`)
    .join(" | ")}`;

  let assumption: string | undefined;
  if (context.config.allowAssumptions && context.assumptions.length > 0) {
    assumption = context.assumptions[0];
  }

  return {
    label: strategy.label,
    summary,
    actions,
    evaluation: strategy.evaluation,
    focus,
    assumption,
  };
}

function buildAnalysis(subgoal: Subgoal, context: AgentState, isActivating: boolean) {
  const status = isActivating ? "Bringing new subgoal into focus." : "Re-evaluating ongoing subgoal.";
  const momentum = subgoal.progress > 0
    ? `Current traction ${(subgoal.progress * 100).toFixed(0)}%.`
    : "No tangible progress yet.";
  const scope = `Goal scope includes ${context.subgoals.length} subgoal${
    context.subgoals.length === 1 ? "" : "s"
  } with ${context.subgoals.filter((item) => item.status === "completed").length} complete.`;
  return `${status} ${momentum} ${scope}`;
}

function executePlan(
  subgoal: Subgoal,
  plan: ActionPlan,
  context: AgentState,
): ExecutionOutcome {
  const now = Date.now();
  const attempts = subgoal.attempts + 1;
  const actionIndex = (attempts - 1) % plan.actions.length;
  const chosenAction = plan.actions[actionIndex] ?? plan.actions[0] ?? "Execute focused experiment";

  const momentumBoost = Math.max(0.15, 0.35 - subgoal.progress * 0.25);
  const randomFactor = 0.2 + Math.random() * 0.5;
  const rawDelta = Number((momentumBoost * randomFactor).toFixed(3));

  const tentativeProgress = Math.min(1, subgoal.progress + rawDelta);
  const madeProgress = tentativeProgress > subgoal.progress + 0.05;
  const nextProgress = madeProgress ? tentativeProgress : subgoal.progress;
  const progressDelta = Number((nextProgress - subgoal.progress).toFixed(3));

  let nextStatus: Subgoal["status"] = nextProgress >= 0.999 ? "completed" : "active";
  let decision = nextStatus === "completed"
    ? `Locked subgoal "${subgoal.description}" as complete. Shift focus to the next open item.`
    : `Momentum registered. Continue driving this thread before reallocating attention.`;

  let observation = madeProgress
    ? `Observed measurable momentum: progress at ${(nextProgress * 100).toFixed(0)}%.`
    : `No visible movement. Investigation required before next loop.`;

  let evaluation = madeProgress
    ? `Trajectory is positive; residual risk manageable. ${plan.evaluation}`
    : `Progress flat. Need to adapt approach or unblock dependencies.`;

  const idleCounter = madeProgress ? 0 : subgoal.idleCounter + 1;
  let terminalStatus: AgentStatus | undefined;

  if (!madeProgress) {
    decision = `Stalled loop detected on "${subgoal.description}". Trigger adaptation and seek alternate tactic.`;
  }

  if (idleCounter > context.config.maxIdleIterations && nextStatus !== "completed") {
    nextStatus = "blocked";
    decision = `Escalated blocker on "${subgoal.description}" after repeated stagnation. Evaluate alternate paths.`;
    evaluation = `Marking as blocked lets the agent explore different leverage points.`;
    observation = `Agent flagged dependency risk; waiting for external input or new data.`;
    terminalStatus = "stopped";
  }

  const updatedSubgoal: Subgoal = {
    ...subgoal,
    status: nextStatus,
    progress: nextProgress,
    attempts,
    idleCounter,
    notes: plan.focus,
    lastUpdated: now,
  };

  if (nextStatus === "completed") {
    updatedSubgoal.notes = "Outcome validated; artifacts captured for traceability.";
  }

  const actionDescription = `Execute: ${chosenAction}. (${plan.focus})`;

  return {
    updatedSubgoal,
    actionDescription,
    observation,
    evaluation,
    decision,
    progressDelta,
    terminalStatus,
  };
}

function buildKickoffLogs(goal: string, assumptions: string[]): AgentLog[] {
  const kickoff: AgentLog[] = [];
  kickoff.push({
    id: createId("log"),
    type: "analysis",
    iteration: 0,
    content: `Initialized autonomous loop with goal: "${goal}"`,
    timestamp: Date.now(),
  });

  if (assumptions.length > 0) {
    kickoff.push({
      id: createId("log"),
      type: "decision",
      iteration: 0,
      content: `Operating assumptions established: ${assumptions.join(" | ")}`,
      timestamp: Date.now(),
    });
  }

  return kickoff;
}

function getActiveSubgoal(subgoals: Subgoal[]): Subgoal | undefined {
  return (
    subgoals.find((item) => item.status === "active") ??
    subgoals.find((item) => item.status === "pending")
  );
}

function createLog(type: AgentLogType, iteration: number, content: string, subgoalId?: string): AgentLog {
  return {
    id: createId("log"),
    type,
    iteration,
    content,
    timestamp: Date.now(),
    subgoalId,
  };
}

function advanceAgent(state: AgentState, allowPaused = false): AgentState {
  const inPausedMode = state.status === "paused";
  const canProceed = state.status === "running" || (allowPaused && inPausedMode);

  if (!canProceed) {
    return state;
  }

  if (!state.goal.trim()) {
    return state;
  }

  const iteration = state.iteration + 1;

  if (iteration > state.config.maxIterations) {
    const nextStatus: AgentStatus = state.subgoals.every((item) => item.status === "completed")
      ? "success"
      : "stopped";
    const completionLog = createLog(
      "decision",
      iteration,
      nextStatus === "success"
        ? "Reached iteration ceiling with all objectives satisfied. Agent shutting down gracefully."
        : "Reached iteration ceiling without full resolution. Marking session as stopped for review.",
    );

    return {
      ...state,
      iteration,
      status: nextStatus,
      logs: [...state.logs, completionLog],
      completedAt: Date.now(),
    };
  }

  const target = getActiveSubgoal(state.subgoals);

  if (!target) {
    const completionLog = createLog(
      "decision",
      iteration,
      "All subgoals complete. Agent mission accomplished.",
    );
    return {
      ...state,
      iteration,
      status: "success",
      logs: [...state.logs, completionLog],
      completedAt: Date.now(),
    };
  }

  const isActivating = target.status === "pending";
  const preparedTarget: Subgoal = {
    ...target,
    status: isActivating ? "active" : target.status,
  };

  const analysisLog = createLog(
    "analysis",
    iteration,
    buildAnalysis(preparedTarget, state, isActivating),
    preparedTarget.id,
  );

  const plan = craftActionPlan(preparedTarget, state);
  const planLog = createLog(
    "plan",
    iteration,
    `${plan.summary}${plan.assumption ? ` Assumption: ${plan.assumption}` : ""}`,
    preparedTarget.id,
  );

  const outcome = executePlan(preparedTarget, plan, state);
  const actionLog = createLog("action", iteration, outcome.actionDescription, preparedTarget.id);
  const observationLog = createLog("observation", iteration, outcome.observation, preparedTarget.id);
  const evaluationLog = createLog("evaluation", iteration, outcome.evaluation, preparedTarget.id);

  const updatedSubgoals = state.subgoals.map((item) =>
    item.id === preparedTarget.id ? outcome.updatedSubgoal : item,
  );

  let nextStatus: AgentStatus = inPausedMode ? "running" : state.status;
  const stagnationCounter = outcome.progressDelta > 0 ? 0 : state.stagnationCounter + 1;

  if (outcome.terminalStatus) {
    nextStatus = outcome.terminalStatus;
  }

  const allDone = updatedSubgoals.every((item) => item.status === "completed");

  if (allDone) {
    nextStatus = "success";
  } else if (stagnationCounter > state.config.maxIdleIterations * 2 && nextStatus === "running") {
    nextStatus = "stopped";
  }

  const decisionLog = createLog(
    "decision",
    iteration,
    allDone
      ? "All objectives validated. Archiving run."
      : nextStatus === "stopped"
        ? "Momentum exhausted. Halting autonomously pending new signal."
        : outcome.decision,
    preparedTarget.id,
  );

  const resultingStatus = inPausedMode && allowPaused && nextStatus === "running"
    ? "paused"
    : nextStatus;

  const completionTimestamp = resultingStatus === "success" || resultingStatus === "stopped"
    ? Date.now()
    : state.completedAt;

  return {
    ...state,
    iteration,
    subgoals: updatedSubgoals,
    logs: [
      ...state.logs,
      analysisLog,
      planLog,
      actionLog,
      observationLog,
      evaluationLog,
      decisionLog,
    ],
    status: resultingStatus,
    stagnationCounter,
    completedAt: completionTimestamp,
  };
}

function agentReducer(state: AgentState, action: AgentAction): AgentState {
  switch (action.type) {
    case "BOOT": {
      const goal = normalizeGoal(action.goal);
      if (!goal) {
        return {
          ...state,
          goal: "",
          normalizedGoal: "",
          subgoals: [],
          logs: [],
          status: "idle",
          iteration: 0,
          assumptions: [],
          stagnationCounter: 0,
        };
      }

      const subgoals = createSubgoals(goal);
      const assumptions = state.config.allowAssumptions ? deriveAssumptions(goal) : [];
      const kickoffLogs = buildKickoffLogs(goal, assumptions);

      return {
        ...state,
        goal,
        normalizedGoal: goal,
        subgoals,
        logs: kickoffLogs,
        status: "running",
        iteration: 0,
        assumptions,
        startedAt: Date.now(),
        completedAt: undefined,
        stagnationCounter: 0,
      };
    }
    case "PAUSE": {
      if (state.status !== "running") {
        return state;
      }
      return {
        ...state,
        status: "paused",
      };
    }
    case "RESUME": {
      if (state.status !== "paused") {
        return state;
      }
      return {
        ...state,
        status: "running",
      };
    }
    case "RESET": {
      const goal = normalizeGoal(action.goal ?? state.goal);
      if (!goal) {
        return {
          ...state,
          goal: "",
          normalizedGoal: "",
          subgoals: [],
          logs: [],
          status: "idle",
          iteration: 0,
          assumptions: [],
          stagnationCounter: 0,
          startedAt: undefined,
          completedAt: undefined,
        };
      }

      const subgoals = createSubgoals(goal);
      const assumptions = state.config.allowAssumptions ? deriveAssumptions(goal) : [];
      const kickoffLogs = buildKickoffLogs(goal, assumptions);

      return {
        ...state,
        goal,
        normalizedGoal: goal,
        subgoals,
        logs: kickoffLogs,
        status: "idle",
        iteration: 0,
        assumptions,
        stagnationCounter: 0,
        startedAt: undefined,
        completedAt: undefined,
      };
    }
    case "STEP": {
      return advanceAgent(state, action.source === "manual");
    }
    case "UPDATE_CONFIG": {
      return {
        ...state,
        config: {
          ...state.config,
          ...action.config,
        },
      };
    }
    default:
      return state;
  }
}

function createInitialState(): AgentState {
  return {
    goal: "",
    normalizedGoal: "",
    status: "idle",
    iteration: 0,
    subgoals: [],
    logs: [],
    assumptions: [],
    config: INITIAL_CONFIG,
    stagnationCounter: 0,
  };
}

function badgeTone(status: Subgoal["status"]): string {
  switch (status) {
    case "pending":
      return "bg-slate-800 text-slate-200 border border-slate-600";
    case "active":
      return "bg-sky-900/60 text-sky-200 border border-sky-500/40";
    case "completed":
      return "bg-emerald-900/60 text-emerald-200 border border-emerald-500/40";
    case "blocked":
      return "bg-rose-900/60 text-rose-200 border border-rose-500/40";
    default:
      return "bg-slate-800 text-slate-200 border border-slate-600";
  }
}

function formatDuration(ms?: number) {
  if (!ms) return "--";
  const sec = Math.floor(ms / 1000);
  const minutes = Math.floor(sec / 60);
  const seconds = sec % 60;
  if (minutes) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function classNames(...values: Array<string | undefined | null | false>) {
  return values.filter(Boolean).join(" ");
}

export default function AgentDashboard() {
  const [state, dispatch] = useReducer(agentReducer, undefined, createInitialState);
  const [goalInput, setGoalInput] = useState(
    "Design and launch an ethical onboarding experience that increases user activation by 25%.",
  );
  const [loopInterval, setLoopInterval] = useState(700);
  const logViewportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (state.status === "running") {
      const timer = setTimeout(() => dispatch({ type: "STEP", source: "loop" }), loopInterval);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [state.status, state.iteration, loopInterval]);

  useEffect(() => {
    if (logViewportRef.current) {
      logViewportRef.current.scrollTop = logViewportRef.current.scrollHeight;
    }
  }, [state.logs.length]);

  const activeSubgoal = useMemo(() => getActiveSubgoal(state.subgoals), [state.subgoals]);
  const totalProgress = useMemo(() => {
    if (state.subgoals.length === 0) {
      return 0;
    }
    const sum = state.subgoals.reduce((acc, item) => acc + item.progress, 0);
    return Math.round((sum / state.subgoals.length) * 100);
  }, [state.subgoals]);

  const elapsedDisplay = useMemo(() => {
    if (!state.startedAt) {
      return "--";
    }
    if (state.completedAt) {
      return formatDuration(state.completedAt - state.startedAt);
    }
    return `${state.iteration} loop${state.iteration === 1 ? "" : "s"}`;
  }, [state.startedAt, state.completedAt, state.iteration]);

  const statusInfo = STATUS_LABEL[state.status];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6">
      <header className="flex flex-col gap-6 rounded-3xl border border-slate-700/60 bg-slate-900/70 p-8 shadow-2xl shadow-slate-950/40 backdrop-blur">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-white md:text-4xl">
              Autonomous Strategy Agent
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-300">
              Self-directed agent that plans, executes, and adapts until objectives are delivered or
              constraints force a stop. Configure a mission, then let the loop drive outcomes while
              staying within ethical guardrails.
            </p>
          </div>
          <div className="flex flex-col items-start gap-2 md:items-end">
            <span className={classNames("rounded-full px-4 py-1 text-sm font-medium", statusInfo.tone)}>
              {statusInfo.label}
            </span>
            <span className="text-xs font-medium uppercase tracking-[0.2em] text-slate-400">
              Iteration {state.iteration}
            </span>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-3">
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              Mission Objective
            </label>
            <textarea
              value={goalInput}
              onChange={(event) => setGoalInput(event.target.value)}
              rows={4}
              className="w-full rounded-2xl border border-slate-600/70 bg-slate-950/60 p-4 text-sm text-slate-100 shadow-inner shadow-slate-950/70 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
              placeholder="Define what the agent must accomplish, including constraints or success criteria."
            />
          </div>
          <div className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-700/70 bg-slate-950/60 p-4">
            <div className="flex flex-col gap-2 text-sm text-slate-300">
              <div className="flex items-center justify-between">
                <span>Loop cadence</span>
                <span>{loopInterval} ms</span>
              </div>
              <input
                type="range"
                min={400}
                max={2000}
                step={100}
                value={loopInterval}
                onChange={(event) => setLoopInterval(Number(event.target.value))}
                className="accent-sky-500"
              />
            </div>
            <div className="flex flex-col gap-2 text-sm text-slate-300">
              <label className="flex items-center justify-between">
                Max iterations
                <input
                  type="number"
                  min={3}
                  max={100}
                  value={state.config.maxIterations}
                  onChange={(event) =>
                    dispatch({
                      type: "UPDATE_CONFIG",
                      config: { maxIterations: Number(event.target.value) },
                    })
                  }
                  className="w-20 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-right text-slate-100"
                />
              </label>
              <label className="flex items-center justify-between gap-4">
                Allow assumptions
                <input
                  type="checkbox"
                  checked={state.config.allowAssumptions}
                  onChange={(event) =>
                    dispatch({ type: "UPDATE_CONFIG", config: { allowAssumptions: event.target.checked } })
                  }
                  className="h-4 w-4 accent-sky-500"
                />
              </label>
              <label className="flex items-center justify-between">
                Idle tolerance
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={state.config.maxIdleIterations}
                  onChange={(event) =>
                    dispatch({
                      type: "UPDATE_CONFIG",
                      config: { maxIdleIterations: Number(event.target.value) },
                    })
                  }
                  className="w-20 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-right text-slate-100"
                />
              </label>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => dispatch({ type: "BOOT", goal: goalInput })}
            disabled={!goalInput.trim() || state.status === "running"}
            className={classNames(
              "rounded-full px-5 py-2 text-sm font-semibold transition",
              state.status === "running"
                ? "cursor-not-allowed bg-slate-700 text-slate-400"
                : "bg-sky-500 text-slate-950 hover:bg-sky-400",
            )}
          >
            Launch autonomous loop
          </button>
          <button
            type="button"
            onClick={() => dispatch({ type: state.status === "paused" ? "RESUME" : "PAUSE" })}
            disabled={state.status === "idle" || state.status === "success" || state.status === "stopped"}
            className="rounded-full border border-slate-600 px-5 py-2 text-sm font-semibold text-slate-200 transition hover:border-sky-500 hover:text-sky-300"
          >
            {state.status === "paused" ? "Resume" : "Pause"}
          </button>
          <button
            type="button"
            onClick={() => dispatch({ type: "STEP", source: "manual" })}
            className="rounded-full border border-slate-600 px-5 py-2 text-sm font-semibold text-slate-200 transition hover:border-emerald-500 hover:text-emerald-300"
          >
            Step once
          </button>
          <button
            type="button"
            onClick={() => dispatch({ type: "RESET", goal: goalInput })}
            className="rounded-full border border-rose-600/70 px-5 py-2 text-sm font-semibold text-rose-200 transition hover:bg-rose-600/10"
          >
            Reset
          </button>
        </div>
      </header>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-4 rounded-3xl border border-slate-700/60 bg-slate-900/70 p-6 shadow-2xl shadow-slate-950/40">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Execution Feed</h2>
            <span className="text-xs uppercase tracking-[0.3em] text-slate-500">Progress {totalProgress}%</span>
          </div>
          <div className="h-[28rem] overflow-y-auto rounded-2xl border border-slate-700/60 bg-slate-950/50 p-4" ref={logViewportRef}>
            <ol className="flex flex-col gap-3">
              {state.logs.map((log) => (
                <li key={log.id} className={classNames("rounded-2xl border px-4 py-3 text-sm leading-relaxed", TAG_STYLES[log.type])}>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs uppercase tracking-[0.2em]">
                    <span>{log.type}</span>
                    <span>Loop {log.iteration}</span>
                  </div>
                  <p className="mt-2 text-sm text-slate-100">{log.content}</p>
                  {log.subgoalId && (
                    <p className="mt-1 text-xs text-slate-400">Subgoal #{state.subgoals.findIndex((s) => s.id === log.subgoalId) + 1}</p>
                  )}
                </li>
              ))}
            </ol>
          </div>
        </div>

        <aside className="flex flex-col gap-4">
          <div className="rounded-3xl border border-slate-700/60 bg-slate-900/70 p-6 shadow-2xl shadow-slate-950/40">
            <h2 className="text-lg font-semibold text-white">Mission Snapshot</h2>
            <div className="mt-4 grid gap-4">
              <div className="rounded-2xl border border-slate-700/60 bg-slate-950/50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Active focus</p>
                <p className="mt-2 text-sm text-slate-100">
                  {activeSubgoal ? activeSubgoal.description : "Awaiting launch or mission complete."}
                </p>
                {activeSubgoal && (
                  <p className="mt-2 text-xs text-slate-400">
                    Confidence {(Math.max(0.25, activeSubgoal.progress) * 100).toFixed(0)}%
                  </p>
                )}
              </div>

              <div className="rounded-2xl border border-slate-700/60 bg-slate-950/50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Operating assumptions</p>
                <ul className="mt-2 space-y-2 text-sm text-slate-100">
                  {state.assumptions.length === 0 && <li className="text-slate-400">None defined.</li>}
                  {state.assumptions.map((assumption) => (
                    <li key={assumption} className="rounded-xl border border-slate-700/60 bg-slate-900/60 p-3 text-xs">
                      {assumption}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-2xl border border-slate-700/60 bg-slate-950/50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Runtime stats</p>
                <dl className="mt-2 grid grid-cols-2 gap-4 text-sm text-slate-100">
                  <div>
                    <dt className="text-xs text-slate-400">Elapsed</dt>
                    <dd>{elapsedDisplay}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-400">Outcome</dt>
                    <dd className="capitalize">{STATUS_LABEL[state.status].label}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-400">Subgoals</dt>
                    <dd>
                      {state.subgoals.filter((item) => item.status === "completed").length}/
                      {state.subgoals.length || 0}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-400">Idle tolerance</dt>
                    <dd>{state.config.maxIdleIterations} loops</dd>
                  </div>
                </dl>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-700/60 bg-slate-900/70 p-6 shadow-2xl shadow-slate-950/40">
            <h2 className="text-lg font-semibold text-white">Subgoal Board</h2>
            <ul className="mt-4 space-y-3">
              {state.subgoals.length === 0 && (
                <li className="rounded-2xl border border-slate-700/60 bg-slate-950/50 p-4 text-sm text-slate-400">
                  Define a mission objective to spawn the autonomous plan.
                </li>
              )}
              {state.subgoals.map((subgoal, index) => (
                <li
                  key={subgoal.id}
                  className="rounded-2xl border border-slate-700/60 bg-slate-950/50 p-4 shadow-inner shadow-slate-950/60"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Subgoal {index + 1}</p>
                      <p className="mt-2 text-sm text-slate-100">{subgoal.description}</p>
                    </div>
                    <span className={classNames("rounded-full px-3 py-1 text-xs font-semibold", badgeTone(subgoal.status))}>
                      {subgoal.status.toUpperCase()}
                    </span>
                  </div>
                  <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-sky-400 to-emerald-400 transition-all"
                      style={{ width: `${Math.round(subgoal.progress * 100)}%` }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
                    <span>Attempts {subgoal.attempts}</span>
                    <span>Progress {(subgoal.progress * 100).toFixed(0)}%</span>
                  </div>
                  {subgoal.notes && (
                    <p className="mt-3 rounded-xl border border-slate-700/60 bg-slate-900/60 p-3 text-xs text-slate-300">
                      {subgoal.notes}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </section>
    </div>
  );
}
