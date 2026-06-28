const assert = require('assert');

const { loadClusterConfig } = require('../../lib/start-cluster');

function createOrchestrator(config) {
  const calls = { loadConfig: [] };
  return {
    calls,
    loadConfig(configPath) {
      calls.loadConfig.push(configPath);
      return config;
    },
  };
}

describe('start-cluster config loading', function () {
  it('resolves parameterized config files with defaults before agents are created', function () {
    const orchestrator = createOrchestrator({
      name: 'Parameterized',
      params: {
        planner_level: { type: 'string', default: 'level3' },
        task_type: { type: 'string', default: 'TASK' },
        timeout: { type: 'number', default: 0 },
      },
      agents: [
        {
          id: 'planner',
          role: 'planning',
          modelLevel: '{{planner_level}}',
          timeout: '{{timeout}}',
          prompt: {
            system: 'Plan a {{task_type}}',
          },
        },
      ],
    });

    const config = loadClusterConfig(orchestrator, '/tmp/parameterized.json', {
      defaultProvider: 'claude',
      providerSettings: {},
    });

    assert.strictEqual(config.params, undefined);
    assert.strictEqual(config.defaultProvider, 'claude');
    assert.strictEqual(config.agents[0].modelLevel, 'level3');
    // Fork's TemplateResolver preserves JS types for pure-placeholder values
    // ("{{timeout}}" with numeric default 0 → number 0, not string "0").
    // See src/template-resolver.js and tests/template-resolver.test.js.
    assert.strictEqual(config.agents[0].timeout, 0);
    assert.strictEqual(config.agents[0].prompt.system, 'Plan a TASK');
  });

  it('applies paramOverrides when resolving a direct parameterized config (e.g. --skip-quality-gate)', function () {
    const makeOrchestrator = () =>
      createOrchestrator({
        name: 'GateTest',
        params: { quality_gate: { type: 'boolean', default: true } },
        agents: [
          { id: 'worker', role: 'implementation', modelLevel: 'level2' },
          {
            id: 'quality-gate',
            role: 'quality-gate',
            modelLevel: 'level2',
            condition: 'quality_gate',
          },
        ],
      });
    const hasGate = (c) => c.agents.some((a) => a.role === 'quality-gate');

    // Default resolution keeps the conditional quality-gate agent.
    assert.strictEqual(hasGate(loadClusterConfig(makeOrchestrator(), '/tmp/gate.json', {})), true);

    // The skip override must reach the direct-file resolver and drop the agent —
    // not be silently ignored (it previously only applied on the conductor load_config path).
    const skipped = loadClusterConfig(makeOrchestrator(), '/tmp/gate.json', {}, undefined, {
      quality_gate: false,
    });
    assert.strictEqual(hasGate(skipped), false);
  });
});
