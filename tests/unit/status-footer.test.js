const assert = require('assert');
const { StatusFooter, AGENT_STATE } = require('../../src/status-footer');
const fs = require('fs');
const { getSubagentEventsDir } = require('../../src/subagent-events');

describe('StatusFooter updateAgent', () => {
  it('maps legacy pid to processPid', () => {
    const footer = new StatusFooter({ enabled: false });
    footer.updateAgent({
      id: 'worker',
      state: AGENT_STATE.EXECUTING_TASK,
      pid: 1234,
      iteration: 1,
    });

    const agent = footer.agents.get('worker');
    assert.strictEqual(agent.processPid, 1234);
    assert.strictEqual(agent.pid, 1234);
  });

  it('prefers explicit processPid over pid', () => {
    const footer = new StatusFooter({ enabled: false });
    footer.updateAgent({
      id: 'worker',
      state: AGENT_STATE.EXECUTING_TASK,
      pid: 1111,
      processPid: 2222,
      iteration: 1,
    });

    const agent = footer.agents.get('worker');
    assert.strictEqual(agent.processPid, 2222);
    assert.strictEqual(agent.pid, 2222);
  });
});

describe('StatusFooter subagent event ownership', () => {
  it('does not delete the cluster event directory when a viewer stops', () => {
    const clusterId = `footer-owner-${process.pid}-${Date.now()}`;
    const eventsDir = getSubagentEventsDir(clusterId);
    fs.mkdirSync(eventsDir, { recursive: true });
    const footer = new StatusFooter({ enabled: false });
    footer.setCluster(clusterId);

    try {
      footer.stop();
      assert.strictEqual(fs.existsSync(eventsDir), true);
    } finally {
      fs.rmSync(eventsDir, { recursive: true, force: true });
    }
  });
});
