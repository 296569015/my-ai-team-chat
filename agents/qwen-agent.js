import { streamAIApi } from '../utils/api-client.js';
import { AgentWithTools } from './agent-with-tools.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * 千问 (Qwen) Agent - 支持流式响应
 * 使用阿里云 DashScope API
 */
export class QwenAgent extends AgentWithTools {
  constructor(model = process.env.QWEN_MODEL || 'qwen-max') {
    super('qwen', '千问', '小千', '阿里云', '代码生成、技术实现和工程化能力');
    this.model = model;
    this.apiKey = process.env.QWEN_API_KEY;
    this.sessions = new Map();
  }

  /**
   * 调用千问 AI - 流式版本
   * @param {string} prompt - 完整提示（包含对话历史）
   * @param {Object} options - 选项
   */
  async *invoke(prompt, options = {}) {
    if (!this.apiKey) {
      yield {
        type: 'error',
        agentId: this.agentId,
        error: '未设置 QWEN_API_KEY 环境变量',
        timestamp: Date.now()
      };
      return;
    }

    // 获取或创建会话
    let sessionId = options.sessionId;
    if (!sessionId) {
      sessionId = `qwen-${Date.now()}`;
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

      // 开始流式响应
      yield {
        type: 'message_start',
        agentId: this.agentId,
        timestamp: Date.now()
      };

      let fullContent = '';
      let buffer = '';

      // 调用流式 API
      for await (const chunk of streamAIApi({
        apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
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
          
          // 每积累一定内容或遇到标点就发送
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

      // 发送剩余内容
      if (buffer.length > 0) {
        yield {
          type: 'message_delta',
          agentId: this.agentId,
          content: fullContent,
          delta: buffer,
          timestamp: Date.now()
        };
      }

      // 发送完整消息结束
      if (fullContent) {
        yield {
          type: 'message',
          agentId: this.agentId,
          content: fullContent,
          timestamp: Date.now()
        };
      }

      // 保存到历史
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
        ? `【千问 API 密钥错误】请检查 .env 文件中的 QWEN_API_KEY 是否正确。错误: ${error.message}`
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
