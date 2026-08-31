const fs = require('fs');
const os = require('os');
const path = require('path');

function getSubagentEventsDir(clusterId) {
  return path.join(os.tmpdir(), 'zeroshot-subagents', clusterId);
}

function getSubagentEventsFile(clusterId, parentAgentId) {
  return path.join(getSubagentEventsDir(clusterId), `${parentAgentId}.jsonl`);
}

function appendSubagentEvent(filePath, event) {
  try {
    const record = `${JSON.stringify(event)}\n`;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, record);
  } catch {
    // Event tracking is best-effort telemetry and must never affect execution.
  }
}

module.exports = {
  getSubagentEventsDir,
  getSubagentEventsFile,
  appendSubagentEvent,
};
