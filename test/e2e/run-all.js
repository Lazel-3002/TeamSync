// Runs every *.test.js file in this directory sequentially against real
// Electron instances (fake media devices) and reports a pass/fail summary.
// Usage: npm run test:e2e
const fs = require('fs');
const path = require('path');

async function main() {
  const dir = __dirname;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.test.js')).sort();
  if (files.length === 0) {
    console.log('No test files found.');
    return;
  }
  const results = [];
  for (const file of files) {
    process.stdout.write(`\n=== ${file} ===\n`);
    const start = Date.now();
    try {
      const testFn = require(path.join(dir, file));
      await testFn();
      results.push({ file, pass: true, ms: Date.now() - start });
      console.log(`PASS (${Date.now() - start}ms)`);
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
