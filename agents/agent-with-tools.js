import { generateToolDescription, executeTool } from '../tools/tool-registry.js';

/**
 * 带工具调用能力的 Agent 基类
 */
export class AgentWithTools {
  constructor(agentId, name, alias, company, specialty) {
    this.agentId = agentId;
    this.name = name;
    this.alias = alias;
    this.company = company;
    this.specialty = specialty;
    this.toolDescription = generateToolDescription();
    this.eventQueue = []; // 用于存储工具事件
  }

  /**
   * 获取系统 Prompt（包含工具说明和身份）
   */
  getSystemPrompt() {
    return `你是 ${this.name}（也可以叫我${this.alias}），来自 ${this.company} 的 AI 助手。

【你的身份】
- 名称：${this.name}
- 别名：${this.alias}
- 公司：${this.company}
- 专长：${this.specialty}
- 角色：你是一个团队成员，正在与其他两位 AI（小千、小K、小D）以及老板（用户）进行讨论。

【对用户的称呼】
- 请称呼用户为"老板"
- 示例："老板，我觉得..."、"老板您说得对..."

【你的任务】
1. 回应用户的直接问题和请求
2. 认真阅读其他 AI 的发言，并在此基础上发表你的观点
3. 你可以：
   - 赞同并补充其他 AI 的观点
   - 提出不同的看法或反对意见
   - 纠正其他 AI 的错误
   - 提出新的角度和想法
   - 向其他 AI 提问以深入了解

【讨论风格】
- 保持友好但有建设性的讨论态度
- 直接称呼对方的名字（如"我同意千问的看法..."、"Kimi 说得对，但我认为..."）
- 避免重复已经说过的内容
- 如果你的观点和其他 AI 相似，请补充新的见解而不是简单重复
- 当有分歧时，解释你的理由

【工具使用】
当用户要求你操作本地系统时，你可以使用以下工具：

${this.toolDescription}

使用工具时，请以以下格式回复：
\`\`\`tool
{
  "tool": "工具名",
  "params": {
    "参数名": "参数值"
  }
}
\`\`\`

工具执行后，系统会返回结果，你可以根据结果继续回复。

【重要提示】
- 记住你是在参与一个团队讨论，不是单独回答问题
- 请用中文回复
- 保持自然、对话式的语气`;
  }

  /**
   * 解析工具调用
   * @param {string} content - AI 的回复内容
   * @returns {Object|null} 工具调用信息或 null
   */
  parseToolCall(content) {
    // 匹配 ```tool 代码块
    const toolMatch = content.match(/```tool\s*\n?([\s\S]*?)\n?```/);
    if (toolMatch) {
      try {
        const toolData = JSON.parse(toolMatch[1].trim());
        if (toolData.tool && toolData.params) {
          return toolData;
        }
      } catch (e) {
        // 解析失败，忽略
      }
    }
    
    // 也尝试匹配 JSON 对象格式
    const jsonMatch = content.match(/\{\s*"tool"\s*:\s*"([^"]+)"\s*,\s*"params"\s*:\s*(\{[^\}]*\})\s*\}/);
    if (jsonMatch) {
      try {
        const params = JSON.parse(jsonMatch[2]);
        return { tool: jsonMatch[1], params };
      } catch (e) {
        // 解析失败，忽略
      }
    }
    
    return null;
  }

  /**
   * 移除工具调用标记，获取纯文本回复
   */
  extractTextContent(content) {
    // 移除工具代码块
    let text = content.replace(/```tool\s*\n?[\s\S]*?\n?```/g, '').trim();
    // 移除 JSON 格式的工具调用
    text = text.replace(/\{\s*"tool"\s*:\s*"[^"]+"\s*,\s*"params"\s*:\s*\{[^\}]*\}\s*\}/g, '').trim();
    return text;
  }

  /**
   * 执行工具调用流程
   * @param {Array} messages - 消息历史
   * @param {Function} chatCallback - 调用 AI 的回调函数
   * @returns {Object} { content: 最终回复内容, events: 工具事件数组 }
   */
  async executeWithTools(messages, chatCallback) {
    let allMessages = [
      { role: 'system', content: this.getSystemPrompt() },
      ...messages
    ];
    
    let toolCallCount = 0;
    const maxToolCalls = 10;
    const events = [];
    
    while (toolCallCount < maxToolCalls) {
      // 调用 AI
      const response = await chatCallback(allMessages);
      const content = response.content || response;
      
      // 解析工具调用
      const toolCall = this.parseToolCall(content);
      
      if (toolCall) {
        toolCallCount++;
        
        // 记录工具调用事件
        events.push({
          type: 'tool_call',
          agentId: this.agentId,
          tool: toolCall.tool,
          params: toolCall.params,
          timestamp: Date.now()
        });
        
        // 执行工具
        const result = await executeTool(toolCall.tool, toolCall.params);
        
        // 记录工具结果事件
        events.push({
          type: 'tool_result',
          agentId: this.agentId,
          tool: toolCall.tool,
          success: result.success,
          result: result,
          timestamp: Date.now()
        });
        
        // 构建工具结果消息
        const resultText = result.success 
          ? `执行成功: ${JSON.stringify(result, null, 2)}`
          : `执行失败: ${result.error}`;
        
        // 添加 AI 回复和工具结果到对话
        allMessages.push({ role: 'assistant', content: content });
        allMessages.push({ 
          role: 'user', 
          content: `[${toolCall.tool} 执行结果]\n${resultText}\n\n请根据结果继续，如果任务完成请告诉用户你做了什么。`
        });
        
      } else {
        // 没有工具调用，返回最终回复
        const textContent = this.extractTextContent(content);
        return { content: textContent, events };
      }
    }
    
    return { 
      content: '', 
      events,
      error: '达到最大工具调用次数限制'
    };
  }
}
