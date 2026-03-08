#!/usr/bin/env node
/**
 * Initialize a new AI Team Chat project
 * Usage: node init-project.js <project-name>
 */

import { mkdirSync, writeFileSync, copyFileSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const skillDir = join(__dirname, '..');

const projectName = process.argv[2] || 'my-ai-chat';
const projectDir = join(process.cwd(), projectName);

console.log(`🚀 Creating AI Team Chat project: ${projectName}`);

// Create directories
mkdirSync(projectDir, { recursive: true });
mkdirSync(join(projectDir, 'agents'), { recursive: true });
mkdirSync(join(projectDir, 'tools'), { recursive: true });
mkdirSync(join(projectDir, 'utils'), { recursive: true });
mkdirSync(join(projectDir, 'public'), { recursive: true });
mkdirSync(join(projectDir, 'scripts'), { recursive: true });

// Copy core files from skill assets (if they exist in the parent project)
const sourceFiles = [
  { src: 'agents/agent-with-tools.js', dest: 'agents/agent-with-tools.js' },
  { src: 'agents/qwen-agent.js', dest: 'agents/qwen-agent.js' },
  { src: 'agents/kimi-agent.js', dest: 'agents/kimi-agent.js' },
  { src: 'agents/deepseek-agent.js', dest: 'agents/deepseek-agent.js' },
  { src: 'tools/tool-registry.js', dest: 'tools/tool-registry.js' },
  { src: 'utils/api-client.js', dest: 'utils/api-client.js' },
  { src: 'utils/mention-parser.js', dest: 'utils/mention-parser.js' },
  { src: 'public/index.html', dest: 'public/index.html' },
  { src: 'public/style.css', dest: 'public/style.css' },
  { src: 'public/app.js', dest: 'public/app.js' },
  { src: 'server.js', dest: 'server.js' }
];

// Try to copy from parent project first, otherwise create templates
const parentDir = join(process.cwd(), '..');
let copiedCount = 0;

sourceFiles.forEach(({ src, dest }) => {
  const parentPath = join(parentDir, src);
  const currentPath = join(process.cwd(), src);
  const destPath = join(projectDir, dest);
  
  if (existsSync(parentPath)) {
    try {
      copyFileSync(parentPath, destPath);
      copiedCount++;
      return;
    } catch (e) {}
  }
  
  if (existsSync(currentPath) && currentPath !== destPath) {
    try {
      copyFileSync(currentPath, destPath);
      copiedCount++;
      return;
    } catch (e) {}
  }
});

// Copy helper scripts to new project
try {
  copyFileSync(join(__dirname, 'add-agent.js'), join(projectDir, 'scripts', 'add-agent.js'));
  copyFileSync(join(__dirname, 'check-project.js'), join(projectDir, 'scripts', 'check-project.js'));
} catch (e) {
  console.log('⚠️  Could not copy helper scripts');
}

// package.json
const packageJson = {
  "name": projectName,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js"
  },
  "dependencies": {
    "express": "^4.18.0",
    "socket.io": "^4.7.0",
    "dotenv": "^16.4.0"
  }
};

writeFileSync(
  join(projectDir, 'package.json'),
  JSON.stringify(packageJson, null, 2)
);

// .env.example
const envExample = `# AI API Keys
QWEN_API_KEY=your_qwen_api_key
KIMI_API_KEY=your_kimi_api_key
DEEPSEEK_API_KEY=your_deepseek_api_key

# Optional
PORT=3000
`;

writeFileSync(join(projectDir, '.env.example'), envExample);

// .gitignore
const gitignore = `node_modules/
.env
*.log
.DS_Store
`;

writeFileSync(join(projectDir, '.gitignore'), gitignore);

// README
const readme = `# ${projectName}

AI Team Chat project - Multiple AI agents chat room with @mentions and session management.

## Quick Start

\`\`\`bash
npm install
# Copy .env.example to .env and fill in API keys
cp .env.example .env
npm start
\`\`\`

Open http://localhost:3000

## Available Scripts

- \`npm start\` - Start server
- \`node scripts/add-agent.js <id> <name> <alias> <company> <specialty>\` - Add new AI
- \`node scripts/check-project.js\` - Check project structure

## Default AI Members

- 小千 (Qwen) - Alibaba - Code generation
- 小K (Kimi) - Moonshot - Long text analysis
- 小D (DeepSeek) - DeepSeek - Reasoning

## Features

- Group chat with multiple AI agents
- @mention support
- Session management (create, rename, delete)
- Local tool execution (file operations, bash)
- Responsive three-column layout
`;

writeFileSync(join(projectDir, 'README.md'), readme);

console.log(`✅ Project created at: ${projectDir}`);
console.log(`📁 Copied ${copiedCount} files from template`);
console.log('');
console.log('Next steps:');
console.log(`  cd ${projectName}`);
console.log('  npm install');
console.log('  cp .env.example .env  # Fill in your API keys');
console.log('  npm start');
