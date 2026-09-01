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

  it('limits rendered subagent rows to the available footer budget', () => {
    const footer = new StatusFooter({ enabled: false });
    footer.subagentTracker = {
      getActiveSubagents: () =>
        Array.from({ length: 100 }, (_, index) => ({
          id: `sub-${index}`,
          description: `Subagent ${index}`,
        })),
    };

    const rows = footer.buildAgentRows(
      [['worker', { state: AGENT_STATE.EXECUTING_TASK, iteration: 1 }]],
      80,
      5
    );

    assert.strictEqual(rows.length, 6);
  });

  it('clips subagent labels to the terminal width', () => {
    const footer = new StatusFooter({ enabled: false });
    footer.subagentTracker = {
      getActiveSubagents: () => [
        { id: 'sub-1', description: 'x'.repeat(80) },
        { id: 'sub-2', description: '界'.repeat(80) },
      ],
    };

    const rows = footer.buildAgentRows(
      [['worker', { state: AGENT_STATE.EXECUTING_TASK, iteration: 1 }]],
      40,
      2
    );

    const displayWidth = (value) =>
      Array.from(footer.stripAnsi(value)).reduce(
        (width, character) => width + (character === '界' ? 2 : 1),
        0
      );
    assert.ok(rows.slice(1).every((row) => displayWidth(row) <= 40));
  });
});
