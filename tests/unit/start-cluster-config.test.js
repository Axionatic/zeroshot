const assert = require('assert');

const { loadClusterConfig, loadForegroundConfig } = require('../../lib/start-cluster');

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

  const makeGateOrchestrator = () =>
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

  it('applies paramOverrides when resolving a direct parameterized config', function () {
    // Default resolution keeps the conditional quality-gate agent.
    assert.strictEqual(
      hasGate(loadClusterConfig(makeGateOrchestrator(), '/tmp/gate.json', {})),
      true
    );

    // The override must reach the direct-file resolver and drop the agent.
    const skipped = loadClusterConfig(makeGateOrchestrator(), '/tmp/gate.json', {}, undefined, {
      quality_gate: false,
    });
    assert.strictEqual(hasGate(skipped), false);
  });

  it('loadForegroundConfig (the CLI run path) honours --skip-quality-gate', function () {
    // The foreground `zeroshot run` path resolves config via loadForegroundConfig,
    // which must derive the override from run options. Without this the flag was
    // silently dropped for direct `--config <parameterized>` runs.
    const present = loadForegroundConfig({
      orchestrator: makeGateOrchestrator(),
      configPath: '/tmp/gate.json',
      settings: {},
      options: {},
    });
    assert.strictEqual(hasGate(present), true);

    const skipped = loadForegroundConfig({
      orchestrator: makeGateOrchestrator(),
      configPath: '/tmp/gate.json',
      settings: {},
      options: { skipQualityGate: true },
    });
    assert.strictEqual(hasGate(skipped), false);
  });
});
