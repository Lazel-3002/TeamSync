// Runs every *.test.js file in this directory sequentially against real
// Electron instances (fake media devices) and reports a pass/fail summary.
// Usage: npm run test:e2e
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const TEST_TIMEOUT_MS = Number(process.env.E2E_TEST_TIMEOUT_MS || 90000);

function runIsolatedTest(file) {
  const filePath = path.resolve(__dirname, file);
  const childScript = `Promise.resolve(require(${JSON.stringify(filePath)})()).then(() => process.exit(0), error => { console.error(error && (error.stack || error)); process.exit(1); });`;

  return new Promise(resolve => {
    const child = spawn(process.execPath, ['-e', childScript], {
      cwd: path.resolve(__dirname, '..', '..'),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let output = '';
    let settled = false;
    const startedAt = Date.now();
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...result, ms: Date.now() - startedAt, output });
    };
    child.stdout.on('data', chunk => { output += chunk.toString(); });
    child.stderr.on('data', chunk => { output += chunk.toString(); });
    child.on('error', error => finish({ pass: false, error: error.message }));
    child.on('close', code => finish({ pass: code === 0, error: code === 0 ? '' : `exit code ${code}` }));

    const timer = setTimeout(() => {
      output += `\nTimed out after ${TEST_TIMEOUT_MS}ms.\n`;
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
          windowsHide: true,
          stdio: 'ignore',
        });
        killer.on('close', () => finish({ pass: false, timedOut: true, error: `timeout after ${TEST_TIMEOUT_MS}ms` }));
        killer.on('error', () => finish({ pass: false, timedOut: true, error: `timeout after ${TEST_TIMEOUT_MS}ms` }));
      } else {
        child.kill('SIGKILL');
        finish({ pass: false, timedOut: true, error: `timeout after ${TEST_TIMEOUT_MS}ms` });
      }
    }, TEST_TIMEOUT_MS);
  });
}

async function main() {
  const dir = __dirname;
  const filter = process.env.E2E_TEST_FILTER;
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.test.js'))
    .filter(f => !filter || f.includes(filter))
    .sort();
  if (files.length === 0) {
    console.log('No test files found.');
    return;
  }
  const results = [];
  for (const file of files) {
    process.stdout.write(`\n=== ${file} ===\n`);
    const start = Date.now();
    try {
      const result = await runIsolatedTest(file);
      results.push({ file, ...result });
      console.log(`${result.pass ? 'PASS' : 'FAIL'} (${result.ms}ms)${result.error ? `: ${result.error}` : ''}`);
      if (!result.pass && result.output) console.log(result.output.trim());
    } catch (e) {
      results.push({ file, pass: false, ms: Date.now() - start, error: e.message });
      console.log(`FAIL (${Date.now() - start}ms): ${e.message}`);
    }
  }

  console.log('\n=== Summary ===');
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.file}  (${r.ms}ms)` + (r.pass ? '' : `  — ${r.error}`));
  }
  const failed = results.filter(r => !r.pass);
  if (failed.length > 0) {
    console.log(`\n${failed.length}/${results.length} test(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log(`\nAll ${results.length} test(s) passed.`);
  }
}

main().then(() => process.exit(process.exitCode || 0));
