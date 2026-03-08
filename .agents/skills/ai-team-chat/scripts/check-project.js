#!/usr/bin/env node
/**
 * Validate AI Team Chat project structure
 * Usage: node check-project.js
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

console.log('🔍 Checking project structure...\n');

const checks = [
  { file: 'package.json', required: true },
  { file: 'server.js', required: true },
  { file: '.env', required: false, hint: 'Copy .env.example to .env and fill in API keys' },
  { file: 'agents/agent-with-tools.js', required: true },
  { file: 'agents/qwen-agent.js', required: true },
  { file: 'agents/kimi-agent.js', required: true },
  { file: 'agents/deepseek-agent.js', required: true },
  { file: 'tools/tool-registry.js', required: true },
  { file: 'utils/api-client.js', required: true },
  { file: 'utils/mention-parser.js', required: true },
  { file: 'public/index.html', required: true },
  { file: 'public/style.css', required: true },
  { file: 'public/app.js', required: true }
];

let passed = 0;
let failed = 0;

checks.forEach(check => {
  const exists = existsSync(join(process.cwd(), check.file));
  if (exists) {
    console.log(`  ✅ ${check.file}`);
    passed++;
  } else if (check.required) {
    console.log(`  ❌ ${check.file} (required)`);
    failed++;
  } else {
    console.log(`  ⚠️  ${check.file} (optional) - ${check.hint}`);
  }
});

console.log('\n' + '='.repeat(40));
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed === 0) {
  console.log('✅ Project structure looks good!');
  console.log('Run: npm install && npm start');
} else {
  console.log('❌ Some required files are missing');
  process.exit(1);
}
