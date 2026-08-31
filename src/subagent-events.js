const fs = require('fs');
const os = require('os');
const path = require('path');

function getSubagentEventsDir(clusterId) {
  return path.join(os.tmpdir(), 'zeroshot-subagents', clusterId);
}

function getSubagentEventsFile(clusterId, parentAgentId) {
  return path.join(getSubagentEventsDir(clusterId), `${parentAgentId}.jsonl`);
}

function prepareSubagentEventsFile(filePath) {
  try {
    const directory = path.dirname(filePath);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.chmodSync(directory, 0o700);
    const fd = fs.openSync(filePath, 'a', 0o600);
    fs.closeSync(fd);
    fs.chmodSync(filePath, 0o600);
    return true;
  } catch {
    return false;
  }
}

function appendSubagentEvent(filePath, event) {
  try {
    const record = `${JSON.stringify(event)}\n`;
    if (!prepareSubagentEventsFile(filePath)) return;
    fs.appendFileSync(filePath, record, { encoding: 'utf8', mode: 0o600 });
  } catch {
    // Event tracking is best-effort telemetry and must never affect execution.
  }
}

module.exports = {
  getSubagentEventsDir,
  getSubagentEventsFile,
  prepareSubagentEventsFile,
  appendSubagentEvent,
};
