import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, '..');
const releaseDir = path.join(desktopDir, 'release');
const strict = process.argv.includes('--strict');
const noExit = process.argv.includes('--no-exit');
const checks = [];

const reportPath = 'release/release-env-bootstrap.json';
const markdownPath = 'release/RELEASE_ENV_BOOTSTRAP.md';
const templatePath = 'release/release-env.local.template';
const verificationPath = strict
  ? 'release/release-env-bootstrap-report.strict.json'
  : 'release/release-env-bootstrap-report.json';

const requiredKeys = [
  'CONNECT_AI_BASELINE_URL',
  'CONNECT_AI_BASELINE_SHA256',
  'CONNECT_AI_ZIP_SHA256',
  'CONNECT_AI_RELEASE_AUDIT_TOKEN',
  'BUILD_CERTIFICATE_PATH',
  'BUILD_CERTIFICATE_BASE64',
  'P12_PASSWORD',
  'KEYCHAIN_PASSWORD',
  'APPLE_API_KEY',
  'APPLE_API_KEY_BASE64',
  'APPLE_API_KEY_ID',
  'APPLE_API_ISSUER',
  'APPLE_ID',
  'APPLE_APP_SPECIFIC_PASSWORD',
  'APPLE_TEAM_ID',
  'APPLE_KEYCHAIN_PROFILE',
];

function readJson(relativePath) {
  const file = path.join(desktopDir, relativePath);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return { parseError: error.message };
  }
}

function readText(relativePath) {
  const file = path.join(desktopDir, relativePath);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function add(name, ok, detail, level = 'blocker') {
  checks.push({
    name,
    ok: Boolean(ok),
    detail,
    level: ok ? 'pass' : level,
  });
}

function hasSecretMaterial(text) {
  const patterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----/,
    /-----BEGIN CERTIFICATE-----/,
    /\bghp_[A-Za-z0-9_]{20,}\b/,
    /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bAIza[0-9A-Za-z_-]{20,}\b/,
    /\bsk-[A-Za-z0-9]{24,}\b/,
  ];
  return patterns.some((pattern) => pattern.test(text));
}

function mentionedKey(text, key) {
  const pattern = new RegExp(`(?:^|\\n)\\s*#?\\s*${key}=`, 'm');
  return pattern.test(text);
}

function baselineUrlLooksValid(value, version) {
  const text = String(value || '').trim();
  try {
    const url = new URL(text);
    return url.protocol === 'https:' && url.pathname.endsWith('.zip') && text.includes(version);
  } catch {
    return false;
  }
}

function asCommandText(report) {
  return [
    ...(report.operatorCommands || []),
    ...((report.githubCommands?.variables || []).map((command) => ({ command }))),
    ...((report.githubCommands?.secrets || []).map((command) => ({ command }))),
  ].map((item) => `${item.step || ''}\n${item.command || ''}\n${item.note || ''}`).join('\n');
}

function printAndExit() {
  const blockers = checks.filter((check) => !check.ok && check.level === 'blocker').length;
  const warnings = checks.filter((check) => !check.ok && check.level === 'warn').length;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    strict,
    summary: { blockers, warnings },
    checks,
  };
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(path.join(desktopDir, verificationPath), `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Connect AI release env bootstrap verification (${strict ? 'strict' : 'local'})`);
  for (const check of checks) {
    const label = check.ok ? 'PASS' : check.level.toUpperCase();
    console.log(`${label.padEnd(7)} ${check.name} - ${check.detail}`);
  }
  console.log(`Summary: ${blockers} blocker(s), ${warnings} warning(s)`);
  console.log(`Wrote ${verificationPath}`);
  if (blockers > 0 && !noExit) process.exit(1);
}

function main() {
  const pkg = readJson('package.json');
  const bootstrap = readJson(reportPath);
  const baselineExport = readJson('release/baseline-export-report.json');
  const markdown = readText(markdownPath);
  const template = readText(templatePath);

  add('release env bootstrap report exists', Boolean(bootstrap && !bootstrap.parseError), bootstrap?.parseError || reportPath);
  add('release env bootstrap notes exist', Boolean(markdown), markdownPath);
  add('release env bootstrap template exists', Boolean(template), templatePath);
  if (!bootstrap || bootstrap.parseError) {
    printAndExit();
    return;
  }

  const sourceReports = Array.isArray(bootstrap.sourceReports) ? bootstrap.sourceReports : [];
  const inputGroups = Array.isArray(bootstrap.inputGroups) ? bootstrap.inputGroups : [];
  const commandText = asCommandText(bootstrap);
  const allText = `${JSON.stringify(bootstrap)}\n${markdown}\n${template}`;
  const missingTemplateKeys = requiredKeys.filter((key) => !mentionedKey(template, key));
	  const missingReportKeys = requiredKeys.filter((key) => !(bootstrap.localEnvKeys || []).includes(key));
	  const baselineSha = baselineExport?.export?.sha256 || null;
	  const baselineUrl = bootstrap.suggestedValues?.CONNECT_AI_BASELINE_URL || '';
	  const baselineUrlRecommendation = bootstrap.baselineUrlRecommendation || {};
	  const templateBaselineUrlIsEmpty = /^CONNECT_AI_BASELINE_URL=$/m.test(template);

  add('release env bootstrap schema version', bootstrap.schemaVersion === 1, String(bootstrap.schemaVersion));
  add('release env bootstrap product version', bootstrap.product?.version === pkg?.version, `${bootstrap.product?.version || 'missing'} expected ${pkg?.version || 'missing'}`);
  add('release env bootstrap status', typeof bootstrap.status === 'string' && bootstrap.status.length > 0, bootstrap.status || 'missing');
  add('release env bootstrap file paths', bootstrap.files?.report === reportPath && bootstrap.files?.markdown === markdownPath && bootstrap.files?.template === templatePath, JSON.stringify(bootstrap.files || {}));
  add('release env bootstrap input groups', inputGroups.length >= 4, `${inputGroups.length} group(s)`);
  add('release env bootstrap source reports', sourceReports.length >= 8, `${sourceReports.length} source report(s)`);
  add('release env bootstrap template key coverage', missingTemplateKeys.length === 0, missingTemplateKeys.length ? `missing ${missingTemplateKeys.join(', ')}` : `${requiredKeys.length} key(s)`);
  add('release env bootstrap report key coverage', missingReportKeys.length === 0, missingReportKeys.length ? `missing ${missingReportKeys.join(', ')}` : `${requiredKeys.length} key(s)`);
	  add(
	    'release env bootstrap baseline SHA projection',
	    !baselineSha || bootstrap.suggestedValues?.CONNECT_AI_BASELINE_SHA256 === baselineSha && template.includes(`CONNECT_AI_BASELINE_SHA256=${baselineSha}`),
	    baselineSha || 'baseline export SHA missing',
	  );
	  add(
	    'release env bootstrap baseline URL candidate shape',
	    baselineUrlLooksValid(baselineUrl, pkg?.version || ''),
	    baselineUrl || 'missing',
	  );
	  add(
	    'release env bootstrap baseline URL remains operator-gated',
	    templateBaselineUrlIsEmpty &&
	      template.includes(baselineUrl) &&
	      baselineUrlRecommendation.safeForDirectUse === false,
	    'template keeps CONNECT_AI_BASELINE_URL empty while documenting the guarded candidate URL',
	  );
	  add(
	    'release env bootstrap baseline URL guard instructions',
	    Array.isArray(baselineUrlRecommendation.requiredBeforeUse) &&
	      baselineUrlRecommendation.requiredBeforeUse.join('\n').includes('SHA-256') &&
	      baselineUrlRecommendation.requiredBeforeUse.join('\n').includes('CONNECT_AI_BASELINE_URL') &&
	      Array.isArray(baselineUrlRecommendation.validationCommands) &&
	      baselineUrlRecommendation.validationCommands.length >= 2,
	    `${baselineUrlRecommendation.status || 'missing'}, ${baselineUrlRecommendation.validationCommands?.length || 0} validation command(s)`,
	  );
	  add(
	    'release env bootstrap command coverage',
	    commandText.includes('release:baseline-export') &&
      commandText.includes('release:env-check:strict:report') &&
      commandText.includes('signing:check:report:env') &&
	      commandText.includes('release:github-setup') &&
	      commandText.includes('release:operator-runbook:process:apply') &&
	      commandText.includes('verify:remote-baseline-approved:refresh') &&
	      commandText.includes('gh variable set CONNECT_AI_BASELINE_URL') &&
	      commandText.includes(baselineUrl) &&
	      commandText.includes('gh secret set CONNECT_AI_RELEASE_AUDIT_TOKEN'),
    'baseline export, env check, signing check, GitHub setup, runbook, remote baseline approval gate, and GitHub variable/secret commands',
  );
  add(
    'release env bootstrap safety rules',
    (bootstrap.safetyRules || []).some((rule) => String(rule).includes('must never contain real secret values')) &&
      (bootstrap.safetyRules || []).some((rule) => String(rule).includes('Never commit .env.release.local')),
    `${bootstrap.safetyRules?.length || 0} rule(s)`,
  );
  add('release env bootstrap report secret scan', !hasSecretMaterial(JSON.stringify(bootstrap)), 'no private key, certificate body, GitHub token, or API key literal patterns');
  add('release env bootstrap notes secret scan', !hasSecretMaterial(markdown), 'no private key, certificate body, GitHub token, or API key literal patterns');
  add('release env bootstrap template secret scan', !hasSecretMaterial(template), 'no private key, certificate body, GitHub token, or API key literal patterns');
  add(
    'release env bootstrap target local env operator-owned',
    bootstrap.files?.targetLocalEnv === '.env.release.local' && bootstrap.files?.template === templatePath,
    '.env.release.local is referenced as the operator-owned target, not written as a bootstrap artifact',
  );
  add(
    'release env bootstrap no real secret warning',
    !allText.includes('BEGIN PRIVATE KEY') && !allText.includes('BEGIN CERTIFICATE'),
    'bootstrap artifacts contain placeholders and key names only',
  );

  printAndExit();
}

main();
