import { streamAIApi } from '../utils/api-client.js';
import { AgentWithTools } from './agent-with-tools.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * DeepSeek Agent - 支持流式响应
 * 使用 DeepSeek API
 */
export class DeepSeekAgent extends AgentWithTools {
  constructor(model = process.env.DEEPSEEK_MODEL || 'deepseek-chat') {
    super('deepseek', 'DeepSeek', '小D', 'DeepSeek', '逻辑推理、数学计算和代码分析');
    this.model = model;
    this.apiKey = process.env.DEEPSEEK_API_KEY;
    this.sessions = new Map();
  }

  /**
   * 调用 DeepSeek AI - 流式版本
   * @param {string} prompt - 完整提示（包含对话历史）
   * @param {Object} options - 选项
   */
  async *invoke(prompt, options = {}) {
    if (!this.apiKey) {
      yield {
        type: 'error',
        agentId: this.agentId,
        error: '未设置 DEEPSEEK_API_KEY 环境变量',
        timestamp: Date.now()
      };
      return;
    }

    let sessionId = options.sessionId;
    if (!sessionId) {
      sessionId = `deepseek-${Date.now()}`;
      this.sessions.set(sessionId, []);
      yield {
        type: 'session_init',
        agentId: this.agentId,
        sessionId: sessionId,
        timestamp: Date.now()
      };
    }

    try {
      const messages = [
        { role: 'system', content: this.getSystemPrompt() },
        { role: 'user', content: prompt }
      ];

      yield {
        type: 'message_start',
        agentId: this.agentId,
        timestamp: Date.now()
      };

      let fullContent = '';
      let buffer = '';

      for await (const chunk of streamAIApi({
        apiUrl: 'https://api.deepseek.com/chat/completions',
        apiKey: this.apiKey,
        body: {
          model: this.model,
          messages: messages
        }
      })) {
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          fullContent += delta;
          buffer += delta;
          
          if (buffer.length >= 5 || /[。！？\n]/.test(delta)) {
            yield {
              type: 'message_delta',
              agentId: this.agentId,
              content: fullContent,
              delta: buffer,
              timestamp: Date.now()
            };
            buffer = '';
          }
        }
      }

      if (buffer.length > 0) {
        yield {
          type: 'message_delta',
          agentId: this.agentId,
          content: fullContent,
          delta: buffer,
          timestamp: Date.now()
        };
      }

      if (fullContent) {
        yield {
          type: 'message',
          agentId: this.agentId,
          content: fullContent,
          timestamp: Date.now()
        };
      }

      const session = this.sessions.get(sessionId);
      session.push({ role: 'user', content: prompt });
      if (fullContent) {
        session.push({ role: 'assistant', content: fullContent });
      }
      if (session.length > 20) {
        session.splice(0, session.length - 20);
      }

      yield {
        type: 'result',
        agentId: this.agentId,
        status: 'success',
        sessionId: sessionId,
        timestamp: Date.now()
      };

      yield {
        type: 'done',
        agentId: this.agentId,
        timestamp: Date.now()
      };

    } catch (error) {
      const isAuthError = error.message.includes('401') || error.message.includes('Authentication');
      const errorMsg = isAuthError 
        ? `【DeepSeek API 密钥错误】请检查 .env 文件中的 DEEPSEEK_API_KEY 是否正确。错误: ${error.message}`
        : error.message;
      yield {
        type: 'error',
        agentId: this.agentId,
        error: errorMsg,
        timestamp: Date.now()
      };
    }
  }
}
