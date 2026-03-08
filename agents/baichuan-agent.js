import { callAIApi } from '../utils/api-client.js';
import { AgentWithTools } from './agent-with-tools.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * 百川 Agent - 知识问答
 */
export class BaichuanAgent extends AgentWithTools {
  constructor(model = process.env.BAICHUAN_MODEL || 'default') {
    super('baichuan', '百川', '小百', '百川智能', '知识问答');
    this.model = model;
    this.apiKey = process.env.BAICHUAN_API_KEY;
    this.sessions = new Map();
  }

  async *invoke(prompt, options = {}) {
    if (!this.apiKey) {
      yield {
        type: 'error',
        agentId: this.agentId,
        error: '未设置 BAICHUAN_API_KEY 环境变量',
        timestamp: Date.now()
      };
      return;
    }

    let sessionId = options.sessionId;
    if (!sessionId) {
      sessionId = `baichuan-${Date.now()}`;
      this.sessions.set(sessionId, []);
      yield {
        type: 'session_init',
        agentId: this.agentId,
        sessionId: sessionId,
        timestamp: Date.now()
      };
    }

    try {
      const userMessage = { role: 'user', content: prompt };
      
      const chatCallback = async (messages) => {
        // TODO: Replace with actual API call
        const response = await callAIApi({
          apiUrl: 'https://api.example.com/chat', // Replace with actual API
          apiKey: this.apiKey,
          body: {
            model: this.model,
            messages: messages
          }
        });
        return { content: response.choices?.[0]?.message?.content };
      };

      const result = await this.executeWithTools([userMessage], chatCallback);
      
      for (const event of result.events) {
        yield event;
      }
      
      if (result.error) {
        yield { type: 'error', agentId: this.agentId, error: result.error, timestamp: Date.now() };
      }
      
      if (result.content) {
        yield { type: 'message', agentId: this.agentId, content: result.content, timestamp: Date.now() };
      }

      const session = this.sessions.get(sessionId);
      session.push({ role: 'user', content: prompt });
      if (result.content) {
        session.push({ role: 'assistant', content: result.content });
      }
      if (session.length > 20) {
        session.splice(0, session.length - 20);
      }

      yield { type: 'result', agentId: this.agentId, status: 'success', sessionId, timestamp: Date.now() };
      yield { type: 'done', agentId: this.agentId, timestamp: Date.now() };

    } catch (error) {
      yield { type: 'error', agentId: this.agentId, error: error.message, timestamp: Date.now() };
    }
  }
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
