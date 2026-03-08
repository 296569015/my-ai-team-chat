import { callAIApi } from '../utils/api-client.js';
import { AgentWithTools } from './agent-with-tools.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * DeepSeek Agent - 支持工具调用
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
   * 调用 DeepSeek AI
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

    // 获取或创建会话
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
      // 构建消息
      const userMessage = { role: 'user', content: prompt };
      
      const chatCallback = async (messages) => {
        const response = await callAIApi({
          apiUrl: 'https://api.deepseek.com/chat/completions',
          apiKey: this.apiKey,
          body: {
            model: this.model,
            messages: messages
          }
        });
        return {
          content: response.choices?.[0]?.message?.content
        };
      };

      // 执行并获取结果
      const result = await this.executeWithTools([userMessage], chatCallback);
      
      // 先发送工具事件
      for (const event of result.events) {
        yield event;
      }
      
      // 发送最终消息
      if (result.error) {
        yield {
          type: 'error',
          agentId: this.agentId,
          error: result.error,
          timestamp: Date.now()
        };
      }
      
      if (result.content) {
        yield {
          type: 'message',
          agentId: this.agentId,
          content: result.content,
          timestamp: Date.now()
        };
      }

      // 保存到历史
      const session = this.sessions.get(sessionId);
      session.push({ role: 'user', content: prompt });
      if (result.content) {
        session.push({ role: 'assistant', content: result.content });
      }
      // 只保留最近 20 条
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
      yield {
        type: 'error',
        agentId: this.agentId,
        error: error.message,
        timestamp: Date.now()
      };
    }
  }
}
