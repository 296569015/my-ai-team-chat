import { streamAIApi } from '../utils/api-client.js';
import { AgentWithTools } from './agent-with-tools.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * 千问 (Qwen) Agent - 支持流式响应和取消
 * 使用阿里云 DashScope API
 * 角色：首席设计师 & 产品经理
 */
export class QwenAgent extends AgentWithTools {
  constructor(model = process.env.QWEN_MODEL || 'qwen-max') {
    super('qwen', '千问', '小千', '阿里云', '创意和视觉设计', '首席设计师 & 产品经理', '负责产品视觉设计、用户体验规划和产品方案');
    this.model = model;
    this.apiKey = process.env.QWEN_API_KEY;
    this.sessions = new Map();
  }

  /**
   * 调用千问 AI - 流式版本（支持取消）
   * @param {string} prompt - 完整提示（包含对话历史）
   * @param {Object} options - 选项，包含 sessionId 和 signal
   */
  async *invoke(prompt, options = {}) {
    const { signal } = options;
    
    // 检查初始取消状态
    if (this.checkCancelled(signal)) {
      yield {
        type: 'cancelled',
        agentId: this.agentId,
        timestamp: Date.now()
      };
      return;
    }
    
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

      // 检查取消（API调用前）
      if (this.checkCancelled(signal)) {
        yield { type: 'cancelled', agentId: this.agentId, timestamp: Date.now() };
        return;
      }

      // 开始流式响应
      yield {
        type: 'message_start',
        agentId: this.agentId,
        timestamp: Date.now()
      };

      let fullContent = '';
      let buffer = '';

      // 调用流式 API（传递取消信号）
      for await (const chunk of streamAIApi({
        apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
        apiKey: this.apiKey,
        body: {
          model: this.model,
          messages: messages
        },
        signal // 传递取消信号
      })) {
        // 检查取消（每次 chunk 后）
        if (this.checkCancelled(signal)) {
          console.log(`[${this.agentId}] 流式响应被取消`);
          yield {
            type: 'cancelled',
            agentId: this.agentId,
            timestamp: Date.now()
          };
          return;
        }
        
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

      // 检查取消（流结束后）
      if (this.checkCancelled(signal)) {
        yield { type: 'cancelled', agentId: this.agentId, timestamp: Date.now() };
        return;
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
      // 检查是否是取消导致的错误
      if (error.name === 'AbortError' || this.checkCancelled(signal)) {
        console.log(`[${this.agentId}] 请求被中止`);
        yield {
          type: 'cancelled',
          agentId: this.agentId,
          timestamp: Date.now()
        };
        return;
      }
      
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

  /**
   * 在工具执行后继续对话（流式版本）
   * @param {string} originalContent - AI 的原始回复（包含工具调用）
   * @param {string} toolResult - 工具执行结果
   * @param {Object} options - 选项，包含 sessionId 和 signal
   */
  async *invokeWithToolResult(originalContent, toolResult, options = {}) {
    const { signal } = options;
    
    if (this.checkCancelled(signal)) {
      yield { type: 'cancelled', agentId: this.agentId, timestamp: Date.now() };
      return;
    }

    try {
      // 构建包含历史对话的消息
      const sessionId = options.sessionId || `qwen-${Date.now()}`;
      const session = this.sessions.get(sessionId) || [];
      
      const messages = [
        { role: 'system', content: this.getSystemPrompt() },
        ...session.slice(-10), // 取最近10条历史
        { role: 'assistant', content: originalContent },
        { role: 'user', content: toolResult }
      ];

      yield {
        type: 'message_start',
        agentId: this.agentId,
        timestamp: Date.now()
      };

      let fullContent = '';
      let buffer = '';

      for await (const chunk of streamAIApi({
        apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
        apiKey: this.apiKey,
        body: {
          model: this.model,
          messages: messages
        },
        signal
      })) {
        if (this.checkCancelled(signal)) {
          yield { type: 'cancelled', agentId: this.agentId, timestamp: Date.now() };
          return;
        }
        
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
      if (error.name === 'AbortError' || this.checkCancelled(signal)) {
        yield { type: 'cancelled', agentId: this.agentId, timestamp: Date.now() };
        return;
      }
      
      yield {
        type: 'error',
        agentId: this.agentId,
        error: error.message,
        timestamp: Date.now()
      };
    }
  }
}
