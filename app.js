const els = {
  mainTimer: document.querySelector("#mainTimer"),
  phaseLabel: document.querySelector("#phaseLabel"),
  summary: document.querySelector("#summary"),
  inhaleSeconds: document.querySelector("#inhaleSeconds"),
  holdInSeconds: document.querySelector("#holdInSeconds"),
  exhaleSeconds: document.querySelector("#exhaleSeconds"),
  holdOutSeconds: document.querySelector("#holdOutSeconds"),
  durationMinutes: document.querySelector("#durationMinutes"),
  cycleCount: document.querySelector("#cycleCount"),
  useCycles: document.querySelector("#useCycles"),
  leadSeconds: document.querySelector("#leadSeconds"),
  preBeepSeconds: document.querySelector("#preBeepSeconds"),
  startPauseButton: document.querySelector("#startPauseButton"),
  stopButton: document.querySelector("#stopButton"),
};

const phaseNames = ["Inhale", "Hold after inhale", "Exhale", "Hold after exhale"];

const state = {
  audioContext: null,
  status: "idle",
  startedAt: 0,
  pausedAt: 0,
  pausedTotal: 0,
  plan: null,
  events: [],
  nextEventIndex: 0,
  tickId: null,
};

function numberValue(input, fallback) {
  const value = Number(input.value);
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, min) {
  return Math.max(min, value);
}

function readSettings() {
  const phaseDurations = [
    clamp(numberValue(els.inhaleSeconds, 5), 1),
    clamp(numberValue(els.holdInSeconds, 45), 0),
    clamp(numberValue(els.exhaleSeconds, 5), 1),
    clamp(numberValue(els.holdOutSeconds, 5), 0),
  ];
  const cycleSeconds = phaseDurations.reduce((sum, value) => sum + value, 0);
  const leadSeconds = clamp(numberValue(els.leadSeconds, 15), 0);
  const preBeepSeconds = clamp(numberValue(els.preBeepSeconds, 3), 0);
  const useCycles = els.useCycles.checked;
  const requestedCycles = Math.ceil(clamp(numberValue(els.cycleCount, 15), 1));
  const requestedSeconds = clamp(numberValue(els.durationMinutes, 15), 1) * 60;
  const timeModeCycles = Math.ceil(requestedSeconds / cycleSeconds);
  const cycles = useCycles ? requestedCycles : timeModeCycles;
  const exerciseSeconds = cycles * cycleSeconds;

  if (!useCycles) {
    els.cycleCount.value = String(timeModeCycles);
  }

  return {
    phaseDurations,
    cycleSeconds,
    cycles,
    exerciseSeconds,
    leadSeconds,
    preBeepSeconds,
    useCycles,
  };
}

function formatClock(seconds, rounding = "ceil") {
  const round = rounding === "floor" ? Math.floor : Math.ceil;
  const rounded = Math.max(0, round(seconds));
  const minutes = Math.floor(rounded / 60);
  const secs = rounded % 60;
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function ensureAudio() {
  if (!state.audioContext) {
    state.audioContext = new AudioContext();
  }
  return state.audioContext;
}

async function beep(kind) {
  const context = ensureAudio();
  if (context.state === "suspended") {
    await context.resume();
  }

  const osc = context.createOscillator();
  const gain = context.createGain();
  const now = context.currentTime;
  const duration = kind === "long" ? 0.65 : 0.13;
  const volume = kind === "long" ? 0.34 : 0.24;

  osc.type = "sine";
  osc.frequency.setValueAtTime(kind === "long" ? 520 : 760, now);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume, now + 0.015);
  gain.gain.setValueAtTime(volume, now + duration - 0.035);
  gain.gain.linearRampToValueAtTime(0, now + duration);
  osc.connect(gain).connect(context.destination);
  osc.start(now);
  osc.stop(now + duration + 0.01);
}

function buildEvents(plan) {
  const events = [];
  const preBeepAt = plan.leadSeconds - plan.preBeepSeconds;

  if (plan.preBeepSeconds > 0 && preBeepAt >= 0) {
    events.push({ at: preBeepAt, kind: "short", label: "Get ready" });
  }

  events.push({ at: plan.leadSeconds, kind: "long", label: "Start" });

  let cursor = plan.leadSeconds;
  for (let cycle = 0; cycle < plan.cycles; cycle += 1) {
    for (let phase = 0; phase < plan.phaseDurations.length; phase += 1) {
      cursor += plan.phaseDurations[phase];
      events.push({
        at: cursor,
        kind: cursor >= plan.leadSeconds + plan.exerciseSeconds ? "long" : "short",
        label: phase === plan.phaseDurations.length - 1 ? "Cycle complete" : phaseNames[phase + 1],
      });
    }
  }

  return events.sort((a, b) => a.at - b.at);
}

function currentElapsed() {
  if (state.status === "paused") {
    return (state.pausedAt - state.startedAt - state.pausedTotal) / 1000;
  }
  return (performance.now() - state.startedAt - state.pausedTotal) / 1000;
}

function currentExerciseElapsed() {
  return Math.max(0, currentElapsed() - state.plan.leadSeconds);
}

function currentPhase(elapsedExercise) {
  const cyclePosition = elapsedExercise % state.plan.cycleSeconds;
  let cursor = 0;

  for (let index = 0; index < state.plan.phaseDurations.length; index += 1) {
    const duration = state.plan.phaseDurations[index];
    if (cyclePosition < cursor + duration || index === state.plan.phaseDurations.length - 1) {
      return {
        name: phaseNames[index],
        remaining: cursor + duration - cyclePosition,
      };
    }
    cursor += duration;
  }

  return { name: "Inhale", remaining: state.plan.phaseDurations[0] };
}

function updateSummary(plan = readSettings()) {
  const mode = plan.useCycles ? "stopwatch" : "timer";
  els.summary.textContent = `${plan.cycles} cycles - ${formatClock(plan.exerciseSeconds)} - ${mode}`;
}

function updateDisplay() {
  if (!state.plan) {
    const plan = readSettings();
    els.mainTimer.textContent = plan.useCycles ? "00:00" : formatClock(plan.exerciseSeconds);
    els.phaseLabel.textContent = "Ready";
    updateSummary(plan);
    return;
  }

  const elapsed = currentElapsed();

  if (elapsed < state.plan.leadSeconds) {
    els.mainTimer.textContent = formatClock(state.plan.leadSeconds - elapsed);
    els.phaseLabel.textContent = "Starting soon";
    return;
  }

  const exerciseElapsed = Math.min(currentExerciseElapsed(), state.plan.exerciseSeconds);

  if (state.plan.useCycles) {
    els.mainTimer.textContent = formatClock(exerciseElapsed, "floor");
  } else {
    els.mainTimer.textContent = formatClock(state.plan.exerciseSeconds - exerciseElapsed);
  }

  if (exerciseElapsed >= state.plan.exerciseSeconds) {
    els.phaseLabel.textContent = "Done";
    return;
  }

  const phase = currentPhase(exerciseElapsed);
  const cycle = Math.floor(exerciseElapsed / state.plan.cycleSeconds) + 1;
  els.phaseLabel.textContent = `${phase.name} - ${formatClock(phase.remaining)} - ${cycle}/${state.plan.cycles}`;
}

function tick() {
  if (state.status !== "running") return;

  const elapsed = currentElapsed();
  while (state.nextEventIndex < state.events.length && elapsed >= state.events[state.nextEventIndex].at) {
    beep(state.events[state.nextEventIndex].kind);
    state.nextEventIndex += 1;
  }

  updateDisplay();

  if (elapsed >= state.plan.leadSeconds + state.plan.exerciseSeconds) {
    finish();
  }
}

function setRunningUi(isRunning) {
  document.body.classList.toggle("session-active", isRunning);
  els.startPauseButton.textContent = isRunning ? "Pause" : "Start";
  els.startPauseButton.classList.toggle("running", isRunning);
  els.stopButton.disabled = !isRunning && state.status !== "paused";
  els.stopButton.classList.toggle("stop-active", isRunning || state.status === "paused");
}

async function start() {
  const context = ensureAudio();
  await context.resume();

  state.plan = readSettings();
  state.events = buildEvents(state.plan);
  state.nextEventIndex = 0;
  state.startedAt = performance.now();
  state.pausedAt = 0;
  state.pausedTotal = 0;
  state.status = "running";

  updateSummary(state.plan);
  setRunningUi(true);
  clearInterval(state.tickId);
  state.tickId = setInterval(tick, 100);
  tick();
}

function pause() {
  state.pausedAt = performance.now();
  state.status = "paused";
  clearInterval(state.tickId);
  setRunningUi(false);
  updateDisplay();
}

function resume() {
  state.pausedTotal += performance.now() - state.pausedAt;
  state.pausedAt = 0;
  state.status = "running";
  clearInterval(state.tickId);
  state.tickId = setInterval(tick, 100);
  setRunningUi(true);
  tick();
}

function stop() {
  state.status = "idle";
  state.plan = null;
  state.events = [];
  state.nextEventIndex = 0;
  clearInterval(state.tickId);
  setRunningUi(false);
  updateDisplay();
}

function finish() {
  state.status = "done";
  clearInterval(state.tickId);
  updateDisplay();
  setRunningUi(false);
  els.stopButton.disabled = true;
}

els.useCycles.addEventListener("change", () => {
  els.durationMinutes.disabled = els.useCycles.checked;
  els.cycleCount.disabled = !els.useCycles.checked;
  if (state.status === "idle" || state.status === "done") updateDisplay();
});

document.querySelectorAll("input").forEach((input) => {
  input.addEventListener("input", () => {
    if (state.status === "idle" || state.status === "done") updateDisplay();
  });
});

els.startPauseButton.addEventListener("click", () => {
  if (state.status === "running") {
    pause();
  } else if (state.status === "paused") {
    resume();
  } else {
    start();
  }
});

els.stopButton.addEventListener("click", stop);

updateDisplay();
