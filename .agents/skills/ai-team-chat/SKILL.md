---
name: ai-team-chat
description: Build a multi-agent AI chat room with Chinese AI models (Qwen, Kimi, DeepSeek). Supports group chat, @mentions, session management, and local tool execution. Use when creating AI team collaboration systems, multi-agent chat interfaces, or AI-powered discussion platforms.
---

# AI Team Chat Skill

Build a visual chat room where multiple AI agents can chat together, with user participation.

## Quick Start

### 1. Project Structure

```
ai-team-chat/
├── agents/                    # AI Agent implementations
│   ├── agent-with-tools.js   # Base class with tool support
│   ├── qwen-agent.js         # Qwen (Alibaba)
│   ├── kimi-agent.js         # Kimi (Moonshot)
│   └── deepseek-agent.js     # DeepSeek
├── tools/                     # Local tool registry
│   └── tool-registry.js      # Bash, File, Search tools
├── utils/                     # Utilities
│   ├── api-client.js         # API call utilities
│   └── mention-parser.js     # @mention parser
├── public/                    # Frontend
│   ├── index.html
│   ├── style.css
│   └── app.js
├── server.js                  # Main server
└── package.json
```

### 2. Core Components

#### AI Agent Base Class

All agents extend `AgentWithTools`:

```javascript
export class MyAgent extends AgentWithTools {
  constructor() {
    super('agent-id', 'Display Name', 'Alias', 'Company', 'Specialty');
    this.apiKey = process.env.MY_API_KEY;
    this.apiUrl = 'https://api.example.com/chat';
  }
  
  async *invoke(prompt, options) {
    // Yield events: message, tool_call, tool_result, error, done
    yield { type: 'message', agentId: this.agentId, content: 'Hello' };
  }
}
```

#### Tool System

Available tools in `tool-registry.js`:
- `Bash` - Execute shell commands
- `Read` - Read file content
- `Write` - Write file
- `Edit` - Find and replace
- `MkDir` - Create directory
- `Ls` - List directory
- `Glob` - Search files
- `Grep` - Text search

#### @Mention System

Parse @mentions in messages:
- `@小千` or `@qwen` - Mention Qwen
- `@小K` or `@kimi` - Mention Kimi
- `@小D` or `@deepseek` - Mention DeepSeek
- `@所有人` or `@all` - Mention all

### 3. Session Management

Sessions support:
- Multiple AI members per session
- Persistent chat history
- Named sessions
- Delete and rename

### 4. Frontend Features

- Three-column layout (sidebar, chat, info)
- @mention autocomplete popup
- Session list with avatars
- Message bubbles with colors per agent
- Tool execution display

## Configuration

### Environment Variables

Create `.env`:

```env
# Qwen (Alibaba DashScope)
QWEN_API_KEY=sk-your-key
QWEN_MODEL=qwen-max

# Kimi (Moonshot)
KIMI_API_KEY=sk-your-key
KIMI_MODEL=moonshot-v1-8k

# DeepSeek
DEEPSEEK_API_KEY=sk-your-key
DEEPSEEK_MODEL=deepseek-chat

# Optional
PORT=3000
```

### Adding New AI Agent

1. Create `agents/my-agent.js`:

```javascript
import { AgentWithTools } from './agent-with-tools.js';

export class MyAgent extends AgentWithTools {
  constructor() {
    super('myagent', 'MyAgent', '小M', 'MyCompany', 'My Specialty');
    this.model = process.env.MY_MODEL || 'default';
    this.apiKey = process.env.MY_API_KEY;
  }
  
  async *invoke(prompt, options) {
    // Implement API call
    // Yield messages and tool results
  }
}
```

2. Register in `server.js`:

```javascript
import { MyAgent } from './agents/my-agent.js';

const agents = {
  qwen: new QwenAgent(),
  kimi: new KimiAgent(),
  deepseek: new DeepSeekAgent(),
  myagent: new MyAgent()  // Add here
};
```

3. Add to `agentConfig` in `public/app.js`:

```javascript
const agentConfig = {
  myagent: { 
    id: 'myagent', 
    name: '小M', 
    realName: 'MyAgent', 
    icon: '🤖', 
    color: '#ff6b6b',
    desc: 'MyCompany, specialty'
  }
};
```

## Design Patterns

### Event-Driven Communication

Server emits events via Socket.io:
- `message` - New message
- `typing` - Agent is thinking
- `waiting_for_user` - All agents done

### Mention Queue System

```
User sends message → Parse @mentions → Add to queue
→ Process each agent in queue → Agent can @ others
→ Continue until queue empty
```

### Tool Execution Flow

```
Agent detects tool in response → Execute tool
→ Return result to agent → Agent continues
→ Yield final message
```

## Common Modifications

### Change Aliases

Edit `agentConfig` in `public/app.js`:

```javascript
const agentConfig = {
  qwen: { name: '新名字', alias: '新别名', ... }
};
```

Update `server.js` AGENT_INFO:

```javascript
const AGENT_INFO = {
  qwen: { name: '新名字', alias: '新别名', ... }
};
```

### Change User Title

Edit `getSystemPrompt()` in `agents/agent-with-tools.js`:

```markdown
【对用户的称呼】
请称呼用户为"新称呼"
```

### Add New Tool

1. Add to `TOOLS` in `tools/tool-registry.js`
2. Implement in `ToolExecutor`
3. Document in system prompt

## Security Notes

- Validate file paths in tools (prevent directory traversal)
- Limit max tool calls per round
- API keys in environment variables only
- Session isolation per user
