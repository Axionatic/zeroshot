#!/usr/bin/env node

/**
 * Quality Gate Runner
 *
 * Read priority:
 *   1. .zeroshot-quality in CWD → manual override
 *   2. ~/.zeroshot/projects/<hash>.json → project config
 *   3. Neither → auto-pass
 *
 * Exit code matches the command's exit code (0 = pass, non-zero = fail).
 * On heuristic-detected command failure, flags source as 'heuristic-failed'
 * so LLM re-detection is tried on next run.
 */

const { execSync } = require('../src/lib/safe-exec');
const fs = require('fs');
const path = require('path');

const QUALITY_FILE = '.zeroshot-quality';

function run() {
  const cwd = process.cwd();
  const qualityPath = path.join(cwd, QUALITY_FILE);

  let command = null;
  let commandSource = null; // 'file' | 'project-config'
  let projectConfig = null;

  // 1. Check .zeroshot-quality manual override
  if (fs.existsSync(qualityPath)) {
    command = fs.readFileSync(qualityPath, 'utf-8').trim();
    commandSource = 'file';
  } else {
    // 2. Check project config
    try {
      const { loadProjectConfig } = require('../lib/project-config');
      projectConfig = loadProjectConfig(cwd);
      if (projectConfig && projectConfig.qualityCommand) {
        command = projectConfig.qualityCommand;
        commandSource = 'project-config';
      }
    } catch {
      // project-config module not available — fall through
    }
  }

  // 3. No quality gate configured → auto-pass
  if (!command) {
    const result = {
      command: null,
      exitCode: 0,
      stdout: 'No pre-validation gate configured — auto-passed',
      stderr: '',
    };
    console.log(JSON.stringify(result));
    process.exit(0);
  }

  let stdout = '';
  let stderr = '';
  let exitCode = 0;

  try {
    stdout = execSync(command, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 115000,
      cwd,
    });
  } catch (error) {
    if (error.killed && error.signal) {
      exitCode = 124;
      stderr = `TIMEOUT: Command killed after timeout by signal ${error.signal}`;
      stdout = error.stdout || '';
    } else {
      exitCode = error.status || 1;
      stdout = error.stdout || '';
      stderr = error.stderr || '';
    }
  }

  // Flag heuristic-detected commands as failed so LLM re-detection is tried next time
  if (exitCode !== 0 && commandSource === 'project-config' && projectConfig) {
    if (projectConfig.source === 'heuristic' || projectConfig.source === 'llm') {
      const failedSource = projectConfig.source === 'heuristic' ? 'heuristic-failed' : 'llm-failed';
      try {
        const { saveProjectConfig } = require('../lib/project-config');
        saveProjectConfig(cwd, {
          ...projectConfig,
          source: failedSource,
          updatedAt: new Date().toISOString(),
        });
      } catch {
        // non-fatal
      }
    }
  }

  const result = {
    command,
    exitCode,
    stdout: stdout || '',
    stderr: stderr || '',
  };

  console.log(JSON.stringify(result));
  process.exit(exitCode);
}

run();
