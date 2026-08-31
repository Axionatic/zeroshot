/**
 * Regression test for isolated mode output capture bug
 *
 * BUG: Isolated mode was reading from `zeroshot task run` command's stdout (help text)
 *      instead of the task's actual log file (JSON output)
 *
 * This test:
 * 1. Spawns a conductor in isolated mode
 * 2. Verifies the agent output comes from the LOG FILE (JSON)
 * 3. Verifies it does NOT contain the spawn command's help text
 */

const assert = require('assert');
const Orchestrator = require('../../src/orchestrator');
const IsolationManager = require('../../src/isolation-manager');
const { spawnClaudeTaskIsolated } = require('../../src/agent/agent-task-executor');
const { getSubagentEventsDir, getSubagentEventsFile } = require('../../src/subagent-events');
const path = require('path');
const fs = require('fs');
const os = require('os');

// This test requires Docker and full isolation mode support
// Skip in CI - isolation mode tests require more than just Docker being available
const isCI = process.env.CI === 'true' || process.env.CI === '1';
const hasDocker = !isCI && IsolationManager.isDockerAvailable();
const hasImage = hasDocker && IsolationManager.imageExists('zeroshot-cluster-base');
const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const hasClaudeCredentials = fs.existsSync(path.join(claudeConfigDir, '.credentials.json'));

const shouldRun = hasDocker && !isCI && hasImage && hasClaudeCredentials;

describe('isolated Claude subagent tracking handoff', () => {
  const clusterId = `zs-isolated-exec-${process.pid}-${Math.random().toString(36).slice(2)}`;
  const agentId = 'isolated-claude';
  const eventsDir = getSubagentEventsDir(clusterId);
  const eventsFile = getSubagentEventsFile(clusterId, agentId);

  afterEach(() => {
    fs.rmSync(eventsDir, { recursive: true, force: true });
  });

  it('creates the event file and passes tracking environment before isolated Claude starts', async () => {
    let receivedEnv;
    const manager = {
      spawnInContainer(receivedClusterId, _command, { env }) {
        assert.strictEqual(receivedClusterId, clusterId);
        assert.strictEqual(fs.existsSync(eventsFile), true);
        receivedEnv = env;
        throw new Error('stop after inspecting spawn handoff');
      },
    };
    const agent = {
      id: agentId,
      role: 'worker',
      config: { outputFormat: 'text' },
      isolation: { manager, clusterId },
      _resolveProvider: () => 'claude',
      _resolveModelSpec: () => ({ model: null }),
      _selectModel: () => null,
      _log: () => {},
    };

    await assert.rejects(
      () => spawnClaudeTaskIsolated(agent, 'test context'),
      /stop after inspecting spawn handoff/
    );

    assert.strictEqual(receivedEnv.ZEROSHOT_TRACK_SUBAGENTS, '1');
    assert.strictEqual(receivedEnv.ZEROSHOT_SUBAGENT_EVENTS_FILE, eventsFile);
  });

  it('keeps a Codex-default cluster event bind available for a Claude agent override', async () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zs-isolated-config-'));
    const manager = new IsolationManager();
    let dockerArgs;
    manager._getRunningContainerId = () => null;
    manager._removeContainerByName = () => {};
    manager._prepareIsolatedWorkspace = (_clusterId, workDir) => workDir;
    manager._createClusterConfigDir = () => configDir;
    manager._getDockerGid = () => '999';
    manager._applyCredentialMounts = () => [];
    manager._warnMissingProviderCredentials = () => {};
    manager._spawnContainer = (_clusterId, args) => {
      dockerArgs = args;
      return 'container-id';
    };
    manager._watchContainerExit = () => {};

    try {
      await manager.createContainer(clusterId, { workDir: '/workspace-source', provider: 'codex' });
      assert.ok(dockerArgs.includes(`${eventsDir}:${eventsDir}`));

      manager.spawnInContainer = (_receivedClusterId, _command, { env }) => {
        assert.strictEqual(fs.existsSync(eventsFile), true);
        assert.strictEqual(env.ZEROSHOT_SUBAGENT_EVENTS_FILE, eventsFile);
        throw new Error('stop after Codex-default handoff inspection');
      };
      const agent = {
        id: agentId,
        role: 'worker',
        config: { outputFormat: 'text' },
        isolation: { manager, clusterId },
        _resolveProvider: () => 'claude',
        _resolveModelSpec: () => ({ model: null }),
        _selectModel: () => null,
        _log: () => {},
      };

      await assert.rejects(
        () => spawnClaudeTaskIsolated(agent, 'test context'),
        /stop after Codex-default handoff inspection/
      );
    } finally {
      fs.rmSync(configDir, { recursive: true, force: true });
    }
  });
});

(shouldRun ? describe : describe.skip)('Isolated Mode Output Capture', () => {
  let orchestrator;
  const storageDir = path.join(__dirname, '.test-storage');

  beforeEach(() => {
    // Clean up storage dir
    if (fs.existsSync(storageDir)) {
      fs.rmSync(storageDir, { recursive: true, force: true });
    }

    orchestrator = new Orchestrator({
      quiet: true,
      skipLoad: true,
      storageDir,
    });
  });

  afterEach(async () => {
    // Kill all clusters
    await orchestrator.killAll();

    // Clean up storage
    if (fs.existsSync(storageDir)) {
      fs.rmSync(storageDir, { recursive: true, force: true });
    }
  });

  it('should read agent output from log file, not spawn stdout', async () => {
    // Use a simple conductor config with JSON output
    const config = {
      agents: [
        {
          id: 'test-conductor',
          role: 'conductor',
          modelLevel: 'level1',
          outputFormat: 'json',
          jsonSchema: {
            type: 'object',
            properties: {
              complexity: {
                type: 'string',
                enum: ['TRIVIAL', 'SIMPLE', 'STANDARD', 'CRITICAL'],
              },
              reasoning: { type: 'string' },
            },
            required: ['complexity', 'reasoning'],
          },
          prompt:
            'Classify this task: {{ISSUE_OPENED.content.text}}. Return JSON with complexity and reasoning.',
          triggers: [
            {
              topic: 'ISSUE_OPENED',
              action: 'execute_task',
            },
          ],
          hooks: {
            onComplete: {
              action: 'publish_message',
              config: {
                topic: 'CLASSIFICATION_DONE',
                content: {
                  text: 'Classification complete',
                  data: { result: '{{result}}' },
                },
              },
            },
          },
        },
      ],
    };

    // Start cluster with isolation
    const cluster = await orchestrator.start(
      config,
      { text: 'Add a login button' },
      { isolation: true }
    );

    // Wait for agent to complete (timeout after 2 minutes)
    const timeout = 120000;
    const start = Date.now();
    let completed = false;

    while (Date.now() - start < timeout) {
      const messages = cluster.messageBus.query({
        cluster_id: cluster.id,
        topic: 'CLASSIFICATION_DONE',
      });

      if (messages.length > 0) {
        completed = true;
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    assert.strictEqual(completed, true, 'Agent should have completed');

    // Get all agent output messages
    const outputMessages = cluster.messageBus.query({
      cluster_id: cluster.id,
      topic: 'AGENT_OUTPUT',
    });

    // CRITICAL: Should NOT contain help text from spawn stdout
    // The bug was that isolated mode captured "zeroshot kill xxx # Stop task"
    const hasHelpText = outputMessages.some((m) => {
      const text = m.content?.text || m.content?.data?.line || '';
      return text.includes('zeroshot kill') || text.includes('# Stop task');
    });

    assert.strictEqual(
      hasHelpText,
      false,
      'Agent output should NOT contain help text from spawn stdout'
    );

    // CRITICAL: Should contain actual JSON output from the task's log file
    let hasValidJson = false;
    let parsedOutput = null;

    for (const msg of outputMessages) {
      const text = msg.content?.text || msg.content?.data?.line || '';
      if (!text.trim().startsWith('{')) continue;

      try {
        const parsed = JSON.parse(text);
        if (parsed.complexity && parsed.reasoning) {
          hasValidJson = true;
          parsedOutput = parsed;
          break;
        }
      } catch {
        // Not valid JSON, continue
      }
    }

    assert.strictEqual(hasValidJson, true, 'Agent output should contain valid JSON from log file');
    assert.ok(parsedOutput, 'Should have parsed JSON output');
    assert.ok(
      ['TRIVIAL', 'SIMPLE', 'STANDARD', 'CRITICAL'].includes(parsedOutput.complexity),
      `Expected valid complexity, got: ${parsedOutput.complexity}`
    );
    assert.strictEqual(typeof parsedOutput.reasoning, 'string');
    assert.ok(parsedOutput.reasoning.length > 0, 'Reasoning should not be empty');
  }).timeout(150000); // 2.5 minute timeout for full test
});
