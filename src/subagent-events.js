const fs = require('fs');
const os = require('os');
const path = require('path');

function assertSafePathComponent(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(value)) {
    throw new TypeError(`${label} must be a safe path component`);
  }
}

function getSubagentEventsDir(clusterId) {
  assertSafePathComponent(clusterId, 'clusterId');
  return path.join(os.tmpdir(), 'zeroshot-subagents', clusterId);
}

function getSubagentEventsFile(clusterId, parentAgentId) {
  assertSafePathComponent(parentAgentId, 'parentAgentId');
  return path.join(getSubagentEventsDir(clusterId), `${parentAgentId}.jsonl`);
}

function prepareSubagentEventsFile(filePath) {
  try {
    const directory = path.dirname(filePath);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    if ((fs.statSync(directory).mode & 0o777) !== 0o711) {
      fs.chmodSync(directory, 0o700);
    }
    const fd = fs.openSync(filePath, 'a', 0o600);
    fs.closeSync(fd);
    fs.chmodSync(filePath, 0o600);
    return true;
  } catch {
    return false;
  }
}

function prepareSharedSubagentEventsFile(filePath) {
  try {
    const directory = path.dirname(filePath);
    fs.mkdirSync(directory, { recursive: true, mode: 0o711 });
    fs.chmodSync(directory, 0o711);
    const fd = fs.openSync(filePath, 'a', 0o622);
    fs.closeSync(fd);
    fs.chmodSync(filePath, 0o622);
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
  prepareSharedSubagentEventsFile,
  appendSubagentEvent,
};
