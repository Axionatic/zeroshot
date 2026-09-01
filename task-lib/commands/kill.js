import chalk from 'chalk';
import { getTask, updateTask } from '../store.js';
import { killTask as killProcess, isProcessRunning } from '../runner.js';

async function waitForProcessExit(pid, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !isProcessRunning(pid);
}

export async function killTaskCommand(taskId) {
  const task = getTask(taskId);

  if (!task) {
    console.log(chalk.red(`Task not found: ${taskId}`));
    process.exit(1);
  }

  if (task.status !== 'running') {
    console.log(chalk.yellow(`Task is not running (status: ${task.status})`));
    return;
  }

  if (!isProcessRunning(task.pid)) {
    console.log(chalk.yellow('Process already dead, updating status...'));
    updateTask(taskId, { status: 'stale', error: 'Process died unexpectedly' });
    return;
  }

  const killed = killProcess(task.pid);

  if (!killed) {
    throw new Error(`Failed to send SIGTERM to task ${taskId}`);
  }

  console.log(chalk.green(`✓ Sent SIGTERM to task ${taskId} (PID: ${task.pid})`));
  if (!(await waitForProcessExit(task.pid))) {
    throw new Error(`Task ${taskId} did not exit after SIGTERM`);
  }
  updateTask(taskId, { status: 'killed', error: 'Killed by user' });
}
