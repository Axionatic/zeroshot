const fs = require('fs');
const path = require('path');
const { getSubagentEventsDir } = require('./subagent-events');
const MAX_EVENT_READ_BYTES = 1024 * 1024;

class SubagentTracker {
  /**
   * Tracks subagent lifecycle events from JSONL files written by the
   * track-subagents.py Claude hook. Each agent gets its own JSONL file
   * at /tmp/zeroshot-subagents/<clusterId>/<agentId>.jsonl.
   *
   * @param {string} clusterId - Cluster ID to track
   */
  constructor(clusterId) {
    this.baseDir = getSubagentEventsDir(clusterId);
    // agentId -> [{id, description, startedAt}]
    this.active = new Map();
    // filePath -> byte offset (avoids re-reading entire file each poll)
    this.offsets = new Map();
  }

  /**
   * Scan the event directory and process new JSONL lines from all agent files.
   * Safe to call frequently — reads only new bytes since last poll.
   */
  poll() {
    let files;
    try {
      files = fs.readdirSync(this.baseDir);
    } catch {
      return; // Dir doesn't exist yet — no subagents spawned
    }

    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      const filePath = path.join(this.baseDir, file);
      const agentId = file.slice(0, -6); // strip .jsonl
      this._readNewEvents(filePath, agentId);
    }
  }

  /**
   * Read new events from a single JSONL file starting at the tracked offset.
   * @param {string} filePath
   * @param {string} agentId
   * @private
   */
  _readNewEvents(filePath, agentId) {
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return;
    }

    const offset = this.offsets.get(filePath) || 0;
    if (stat.size <= offset) return; // No new data

    const readLength = Math.min(stat.size - offset, MAX_EVENT_READ_BYTES);
    let chunk;
    try {
      const fd = fs.openSync(filePath, 'r');
      const buf = Buffer.alloc(readLength);
      fs.readSync(fd, buf, 0, buf.length, offset);
      fs.closeSync(fd);
      chunk = buf.toString('utf8');
    } catch {
      return;
    }

    const finalNewline = chunk.lastIndexOf('\n');
    if (finalNewline === -1) {
      if (readLength === MAX_EVENT_READ_BYTES) {
        this.offsets.set(filePath, offset + readLength);
      }
      return; // Wait for a complete record, or discard one that exceeds the byte bound.
    }

    const completeChunk = chunk.slice(0, finalNewline + 1);
    this.offsets.set(filePath, offset + Buffer.byteLength(completeChunk, 'utf8'));

    for (const line of completeChunk.split('\n')) {
      if (!line.trim()) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue; // Malformed line — skip
      }
      this._processEvent(agentId, event);
    }
  }

  /**
   * Process a single start/stop event.
   * @param {string} agentId - Parent agent that spawned the subagent
   * @param {object} event - {event: 'start'|'stop', agent_id, description, ts}
   * @private
   */
  _processEvent(agentId, event) {
    if (
      !event ||
      typeof event !== 'object' ||
      Array.isArray(event) ||
      (event.event !== 'start' && event.event !== 'stop') ||
      typeof event.agent_id !== 'string' ||
      !event.agent_id.trim() ||
      typeof event.ts !== 'number' ||
      !Number.isFinite(event.ts) ||
      (event.description !== undefined && typeof event.description !== 'string') ||
      (event.agent_type !== undefined && typeof event.agent_type !== 'string')
    ) {
      return;
    }

    if (!this.active.has(agentId)) {
      this.active.set(agentId, []);
    }
    const list = this.active.get(agentId);

    if (event.event === 'start') {
      if (list.some((subagent) => subagent.id === event.agent_id)) return;
      list.push({
        id: event.agent_id,
        description: event.description || event.agent_type || 'subagent',
        startedAt: event.ts,
      });
    } else if (event.event === 'stop') {
      const idx = list.findIndex((s) => s.id === event.agent_id);
      if (idx !== -1) list.splice(idx, 1);
    }
  }

  /**
   * Get currently active subagents for a given parent agent.
   * @param {string} agentId
   * @returns {Array<{id: string, description: string, startedAt: number}>}
   */
  getActiveSubagents(agentId) {
    return this.active.get(agentId) || [];
  }

  /**
   * Remove the cluster's event directory.
   */
  cleanup() {
    try {
      fs.rmSync(this.baseDir, { recursive: true, force: true });
    } catch {
      // Already gone or never created
    }
  }
}

module.exports = { SubagentTracker };
