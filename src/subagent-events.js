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
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(event)}\n`);
}

module.exports = {
  getSubagentEventsDir,
  getSubagentEventsFile,
  appendSubagentEvent,
};
