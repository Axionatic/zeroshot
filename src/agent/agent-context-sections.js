const { readFileSync } = require('fs');
const { join, resolve } = require('path');

const { isPlatformMismatchReason } = require('./validation-platform');

const EXAMPLE_PRIMITIVE_VALUES = {
  boolean: true,
  number: 0,
  integer: 0,
};

function generateExampleValue(propSchema, key) {
  if (!propSchema) {
    return undefined;
  }

  if (Array.isArray(propSchema.enum) && propSchema.enum.length > 0) {
    return propSchema.enum[0];
  }

  if (propSchema.type === 'string') {
    return propSchema.description || `${key} value`;
  }

  if (propSchema.type === 'array') {
    return [];
  }

  if (propSchema.type === 'object') {
    return generateExampleFromSchema(propSchema) || {};
  }

  return EXAMPLE_PRIMITIVE_VALUES[propSchema.type];
}

function generateExampleFromSchema(schema) {
  if (!schema || schema.type !== 'object' || !schema.properties) {
    return null;
  }

  const example = {};

  for (const [key, propSchema] of Object.entries(schema.properties)) {
    const value = generateExampleValue(propSchema, key);
    if (value !== undefined) {
      example[key] = value;
    }
  }

  return example;
}

function buildAutonomousSection() {
  return [
    '## AUTONOMOUS MODE',
    '',
    'NON-INTERACTIVE. No user present.',
    'FORBIDDEN: AskUserQuestion, "Should I...", "Would you like...", waiting for input.',
    'Decisions: quality > permissiveness, required scope only.',
    '',
  ].join('\n');
}

function buildOutputStyleSection() {
  return [
    '## OUTPUT DENSITY',
    '',
    'Pattern: [thing] [action] [reason]. No articles, hedging, filler.',
    'Fragments OK. Dense technical prose. Short synonyms.',
    '',
    'FORBIDDEN: "I\'ll", "Let me", "Going to", "Sure!", "Here is", "Certainly"',
    'FORBIDDEN: Repeating instructions back. Restating the question. Preambles.',
    '',
    'Schema strings: Facts only. Max density.',
    'Errors: FULL detail (stack traces, repro steps). Never compress errors.',
    'Progress: "Reading auth.ts" not "I will now read the auth.ts file"',
    '',
  ].join('\n');
}

function buildGitOperationsSection() {
  return [
    '## GIT — FORBIDDEN',
    'No commits/pushes/PRs. Only modify files. git-pusher handles git after validation.',
    '',
  ].join('\n');
}

function buildHeaderContext({ id, role, iteration, isIsolated }) {
  return [
    `You are agent "${id}" with role "${role}".`,
    '',
    `Iteration: ${iteration}`,
    '',
    buildAutonomousSection(),
    buildOutputStyleSection(),
    isIsolated ? '' : buildGitOperationsSection(),
  ]
    .filter(Boolean)
    .join('\n');
}

function buildInstructionsSection({ config, selectedPrompt, id }) {
  const promptText =
    selectedPrompt || (typeof config.prompt === 'string' ? config.prompt : config.prompt?.system);

  if (promptText) {
    return `## Instructions\n\n${promptText}\n\n`;
  }

  if (config.prompt && typeof config.prompt !== 'string' && !config.prompt?.system) {
    throw new Error(
      `Agent "${id}" has invalid prompt format. ` +
        `Expected string or object with .system property, got: ${JSON.stringify(config.prompt).slice(0, 100)}...`
    );
  }

  return '';
}

function hasIgnoredRepoToolingError(error) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error.code)
  );
}

function resolveRepoToolingRoots({ config, worktree }) {
  return Array.from(
    new Set(
      [worktree?.path, config?.cwd, process.cwd()]
        .filter((value) => typeof value === 'string' && value.trim() !== '')
        .map((value) => resolve(value))
    )
  );
}

function buildRepoToolingSection({ config, worktree }) {
  for (const root of resolveRepoToolingRoots({ config, worktree })) {
    const skillPath = join(root, '.claude', 'skills', 'repo-tooling', 'SKILL.md');

    try {
      const content = readFileSync(skillPath, 'utf8').trim();
      if (content !== '') {
        return `${content}\n\n`;
      }
    } catch (error) {
      if (!hasIgnoredRepoToolingError(error)) {
        throw error;
      }
    }
  }

  return '';
}

function buildLegacyOutputSchemaSection(config) {
  if (!config.prompt?.outputFormat) {
    return '';
  }

  const rules = (config.prompt.outputFormat.rules || []).map((rule) => `- ${rule}`).join('\n');

  return [
    '## Output Schema (REQUIRED)',
    '',
    '```json',
    JSON.stringify(config.prompt.outputFormat.example),
    '```',
    '',
    'STRING VALUES IN THIS SCHEMA: Dense. Factual. No filler words. No pleasantries.',
    rules,
    '',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildJsonSchemaSection(config) {
  if (!config.jsonSchema || config.outputFormat !== 'json') {
    return '';
  }

  const lines = [
    '## JSON OUTPUT — REQUIRED',
    '',
    'Response must be ONLY valid JSON. Start with { end with }. Nothing else.',
    '',
    'Required schema:',
    '```json',
    JSON.stringify(config.jsonSchema),
    '```',
    '',
  ];

  const example = generateExampleFromSchema(config.jsonSchema);
  if (example) {
    lines.push('Example output:', '```json', JSON.stringify(example), '```', '');
  }

  lines.push(
    'No preamble/explanation. Exact enum values (case-sensitive). All required fields.',
    ''
  );

  return lines.join('\n');
}

function shouldKeepCannotValidate(criteria, ignoreReason, seenIds) {
  if (criteria.status !== 'CANNOT_VALIDATE' || !criteria.id) {
    return false;
  }

  if (ignoreReason && ignoreReason(criteria.reason)) {
    return false;
  }

  if (seenIds.has(criteria.id)) {
    return false;
  }

  return true;
}

function collectCannotValidateCriteria(prevValidations, options = {}) {
  const cannotValidateCriteria = [];
  const seenIds = new Set();
  const ignoreReason = options.ignoreReason;

  for (const msg of prevValidations) {
    const criteriaResults = msg.content?.data?.criteriaResults;
    if (!Array.isArray(criteriaResults)) {
      continue;
    }

    for (const criteria of criteriaResults) {
      if (!shouldKeepCannotValidate(criteria, ignoreReason, seenIds)) {
        continue;
      }

      seenIds.add(criteria.id);
      cannotValidateCriteria.push({
        id: criteria.id,
        reason: criteria.reason || 'No reason provided',
      });
    }
  }

  return cannotValidateCriteria;
}

function buildCannotValidateSection(cannotValidateCriteria) {
  if (cannotValidateCriteria.length === 0) {
    return '';
  }

  return [
    '',
    '## SKIP — Unverifiable Criteria',
    '',
    'Environmental limitations unchanged. Mark CANNOT_VALIDATE again with same reason.',
    '',
    ...cannotValidateCriteria.map((criteria) => `- ${criteria.id}: ${criteria.reason}`),
    '',
  ].join('\n');
}

function buildValidatorSkipSection({ role, messageBus, cluster, isolation }) {
  if (role !== 'validator') {
    return '';
  }

  const prevValidations = messageBus.query({
    cluster_id: cluster.id,
    topic: 'VALIDATION_RESULT',
    since: cluster.createdAt,
    limit: 50,
  });
  const ignoreReason = isolation?.enabled ? isPlatformMismatchReason : null;
  const cannotValidateCriteria = collectCannotValidateCriteria(prevValidations, { ignoreReason });

  return buildCannotValidateSection(cannotValidateCriteria);
}

function buildTriggeringMessageSection(triggeringMessage) {
  const lines = [
    '',
    '## Triggering Message',
    '',
    `Topic: ${triggeringMessage.topic}`,
    `Sender: ${triggeringMessage.sender}`,
  ];

  if (triggeringMessage.content?.text) {
    lines.push('', triggeringMessage.content.text);
  }

  return `${lines.join('\n')}\n`;
}

module.exports = {
  buildHeaderContext,
  buildInstructionsSection,
  buildJsonSchemaSection,
  buildLegacyOutputSchemaSection,
  buildRepoToolingSection,
  buildTriggeringMessageSection,
  buildValidatorSkipSection,
};
