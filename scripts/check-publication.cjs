// Read-only guard for Git candidates and every reachable local commit.
// Never print matched values. No network request and no Firebase initialization.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const git = args => cp.execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 30000000 });
const names = value => value.split('\0').filter(Boolean);
const forbidden = file => {
  const parts = file.replaceAll('\\', '/').split('/'), name = parts.at(-1);
  return parts.some(part => ['.data', '.local-backups', 'node_modules', '.firebase', '.auth', '_source_original', 'Movix_Analyse_Code', 'output', 'test-results', 'playwright-report', 'screenshots', '.secrets', 'credentials'].includes(part)) ||
    (/^\.env(?:\.|$)/.test(name) && name !== '.env.example') ||
    /^(?:\.npmrc|\.netrc|\.firebaserc|application_default_credentials\.json|authorized_user\.json|(?:storage-?state|auth-?state|cookies).*\.json)$/i.test(name) ||
    /(?:firebase-adminsdk|service.?account|private.?key).*\.json$/i.test(name) ||
    /\.(?:pem|key|p12|pfx|keystore|har|log|sqlite3?|db|dump|sql|bak|backup)$/i.test(name) ||
    /^RAPPORT.*\.md$/i.test(name);
};
const patterns = [
  ['PRIVATE_KEY', /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----\s+[A-Za-z0-9+/=\r\n]{64,}/g],
  ['GITHUB_TOKEN', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/g],
  ['GOOGLE_TOKEN', /\b(?:ya29\.[A-Za-z0-9._-]{20,}|1\/\/[A-Za-z0-9_-]{30,})/g],
  ['AWS_ACCESS_KEY', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['JWT', /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{15,}\b/g],
  ['LITERAL_TMDB_KEY', /\b(?:TMDB_API_KEY|tmdbApiKey)\s*[:=]\s*['"][a-f0-9]{32}['"]/gi],
  ['AUTHENTICATED_URL', /https?:\/\/[^\s/:@"']+:[^\s/@"']+@/g]
];

function scan(file, buffer, known = [], location = 'working-tree') {
  const issues = [];
  if (forbidden(file)) issues.push({ file, location, code: 'PRIVATE_PATH' });
  if (buffer.includes(0)) return issues; // Assets are preserved; binary analysis is manual.
  const text = buffer.toString('utf8');
  for (const [code, expression] of patterns) {
    expression.lastIndex = 0;
    const match = expression.exec(text);
    if (match) issues.push({ file, location, code, line: text.slice(0, match.index).split('\n').length });
  }
  for (const secret of known) {
    const index = text.indexOf(secret);
    if (index >= 0) issues.push({ file, location, code: 'KNOWN_PRIVATE_VALUE', line: text.slice(0, index).split('\n').length });
  }
  return issues;
}

function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !arg.startsWith('--private-env='))) throw new Error('Unsupported audit argument');
  const known = [];
  for (const arg of args) {
    const env = fs.readFileSync(path.resolve(arg.slice('--private-env='.length)), 'utf8');
    for (const line of env.split(/\r?\n/)) {
      const match = /^\s*(?:TMDB_API_KEY|VIDMOLY_API_KEY|.*(?:SECRET|PRIVATE_KEY|PASSWORD|ACCESS_TOKEN|REFRESH_TOKEN))\s*=\s*(.*?)\s*$/.exec(line);
      if (match && match[1].length >= 12) known.push(match[1].replace(/^['"]|['"]$/g, ''));
    }
  }
  const repo = git(['rev-parse', '--show-toplevel']).trim();
  const candidates = [...new Set(names(git(['ls-files', '--cached', '--others', '--exclude-standard', '-z'])))];
  const staged = new Map(names(git(['ls-files', '--stage', '-z'])).map(row => {
    const [metadata, file] = row.split('\t');
    return [file, metadata.split(' ')[1]];
  }));
  const hashAlgorithm = git(['rev-parse', '--show-object-format']).trim();
  const issues = [];
  for (const file of candidates) {
    const full = path.join(root, file), stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) { issues.push({ file, code: 'SYMLINK_REQUIRES_REVIEW' }); continue; }
    if (stat.size > 100000000) { issues.push({ file, code: 'GITHUB_FILE_TOO_LARGE' }); continue; }
    const buffer = fs.readFileSync(full);
    const blob = createHash(hashAlgorithm).update('blob ' + buffer.length + '\0').update(buffer).digest('hex');
    // Refuse a stale/partially staged version: a clean worktree must not conceal
    // older sensitive bytes still waiting in Git's index.
    if (staged.has(file) && staged.get(file) !== blob) issues.push({ file, code: 'INDEX_DIFFERS_REVIEW_REQUIRED' });
    issues.push(...scan(file, buffer, known));
  }
  const ignoredTracked = names(git(['ls-files', '-ci', '--exclude-standard', '-z']));
  for (const file of ignoredTracked) issues.push({ file, code: 'IGNORED_BUT_TRACKED' });
  const commits = git(['rev-list', '--all']).trim().split('\n').filter(Boolean);
  for (const commit of commits) {
    const paths = names(git(['ls-tree', '--full-tree', '-r', '--name-only', '-z', commit]));
    for (const file of paths) {
      const data = cp.execFileSync('git', ['show', commit + ':' + file], { cwd: root, maxBuffer: 110000000 });
      issues.push(...scan(file, data, known, commit.slice(0, 12)));
    }
  }
  console.log(JSON.stringify({ isolatedProjectRoot: path.resolve(repo) === root, candidates: candidates.length,
    commits: commits.length, ignoredTracked: ignoredTracked.length, knownPrivateValuesChecked: known.length,
    issues, limits: 'Heuristic text scan; binary assets, provider permissions and future edits need review.' }, null, 2));
  if (issues.length || path.resolve(repo) !== root) process.exitCode = 1;
}

if (require.main === module) {
  try { main(); } catch { console.error('PUBLICATION_AUDIT_UNAVAILABLE'); process.exitCode = 2; }
}
module.exports = { forbidden, scan };
