const { appendSubagentEvent } = require('./subagent-events');

const TERMINAL_AGENT_STATES = new Set([
  'completed',
  'errored',
  'interrupted',
  'shutdown',
  'not_found',
]);

function getAgentState(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return null;
  if (typeof value.status === 'string') return value.status;
  if (typeof value.state === 'string') return value.state;
  return null;
}

function getAgentStateEntries(agentsStates) {
  if (Array.isArray(agentsStates)) {
    return agentsStates
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const id = entry.thread_id || entry.agent_id || entry.id;
        return typeof id === 'string' ? [id, entry] : null;
      })
      .filter(Boolean);
  }
  if (!agentsStates || typeof agentsStates !== 'object') return [];
  return Object.entries(agentsStates);
}

function createCodexSubagentObserver({ eventsFile, now = Date.now }) {
  let rootThreadId = null;
  let finalized = false;
  const knownChildren = new Set();
  const activeChildren = new Set();

  function append(event, childId, description) {
    try {
      const record = {
        event,
        agent_id: childId,
      };
      if (description) record.description = description;
      record.ts = now();
      appendSubagentEvent(eventsFile, record);
    } catch {
      // Codex collaboration telemetry must never affect task execution.
    }
  }

  function startChild(childId, description) {
    if (knownChildren.has(childId)) return;
    knownChildren.add(childId);
    activeChildren.add(childId);
    append('start', childId, description);
  }

  function stopChild(childId) {
    if (!activeChildren.has(childId)) return;
    activeChildren.delete(childId);
    append('stop', childId);
  }

  function observeAgentStates(record, item) {
    const candidates = [record.agents_states, item.agents_states];
    for (const agentsStates of candidates) {
      for (const [childId, value] of getAgentStateEntries(agentsStates)) {
        if (TERMINAL_AGENT_STATES.has(getAgentState(value))) {
          stopChild(childId);
        }
      }
    }
  }

  function observeSpawn(item) {
    if (
      rootThreadId === null ||
      item.status !== 'completed' ||
      item.sender_thread_id !== rootThreadId ||
      !Array.isArray(item.receiver_thread_ids)
    ) {
      return;
    }
    const description = typeof item.prompt === 'string' && item.prompt ? item.prompt : 'subagent';
    for (const childId of item.receiver_thread_ids) {
      if (typeof childId === 'string' && childId) startChild(childId, description);
    }
  }

  function observeClose(item) {
    if (item.status !== 'completed' || !Array.isArray(item.receiver_thread_ids)) return;
    for (const childId of item.receiver_thread_ids) {
      if (typeof childId === 'string') stopChild(childId);
    }
  }

  function captureRootThread(record) {
    if (
      rootThreadId !== null ||
      record.type !== 'thread.started' ||
      typeof record.thread_id !== 'string' ||
      !record.thread_id
    ) {
      return false;
    }
    rootThreadId = record.thread_id;
    return true;
  }

  function observeLine(line) {
    try {
      if (finalized || typeof line !== 'string') return;
      const record = JSON.parse(line.trim());
      if (!record || typeof record !== 'object') return;

      if (captureRootThread(record)) return;

      if (record.type !== 'item.completed') return;
      const item = record.item;
      if (!item || typeof item !== 'object' || item.type !== 'collab_tool_call') return;

      observeAgentStates(record, item);

      if (item.tool === 'spawn_agent') {
        observeSpawn(item);
        return;
      }

      if (item.tool === 'close_agent') observeClose(item);
    } catch {
      // Malformed or unavailable telemetry is ignored.
    }
  }

  function finishParent() {
    try {
      if (finalized) return;
      finalized = true;
      for (const childId of activeChildren) {
        stopChild(childId);
      }
    } catch {
      // Cleanup telemetry must never affect parent settlement.
    }
  }

  return { observeLine, finishParent };
}

module.exports = { createCodexSubagentObserver };
