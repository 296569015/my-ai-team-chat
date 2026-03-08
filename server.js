import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { QwenAgent } from './agents/qwen-agent.js';
import { KimiAgent } from './agents/kimi-agent.js';
import { DeepSeekAgent } from './agents/deepseek-agent.js';
import { parseMentions } from './utils/mention-parser.js';
import { randomUUID } from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

// 调试：检查环境变量
console.log('Environment check:');
console.log('QWEN_API_KEY:', process.env.QWEN_API_KEY ? '已设置 (' + process.env.QWEN_API_KEY.slice(0, 10) + '...)' : '未设置');
console.log('KIMI_API_KEY:', process.env.KIMI_API_KEY ? '已设置 (' + process.env.KIMI_API_KEY.slice(0, 10) + '...)' : '未设置');
console.log('DEEPSEEK_API_KEY:', process.env.DEEPSEEK_API_KEY ? '已设置 (' + process.env.DEEPSEEK_API_KEY.slice(0, 10) + '...)' : '未设置');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// 静态文件服务
app.use(express.static(join(__dirname, 'public')));
app.use(express.json());

// 初始化三个 AI Agent
const agents = {
  qwen: new QwenAgent(),
  kimi: new KimiAgent(),
  deepseek: new DeepSeekAgent()
};

// AI 成员信息
const AGENT_INFO = {
  qwen: { id: 'qwen', name: '小千', realName: '千问', company: '阿里云', icon: '🤖', color: '#f59e0b' },
  kimi: { id: 'kimi', name: '小K', realName: 'Kimi', company: '月之暗面', icon: '🌙', color: '#8b5cf6' },
  deepseek: { id: 'deepseek', name: '小D', realName: 'DeepSeek', company: 'DeepSeek', icon: '🔍', color: '#3b82f6' }
};

// ============================================
// 安全控制机制
// ============================================

// 会话存储（内存中，实际应用应该用数据库）
const sessions = new Map();
const userSessions = new Map(); // userId -> [sessionIds]

// 活跃的控制器（用于取消执行）
const activeControllers = new Map(); // sessionId -> AbortController

// 每轮每Agent最大回复次数
const MAX_REPLY_PER_ROUND = 5;

// 每轮全局最大调用次数（所有Agent合计）
const MAX_TOTAL_CALLS_PER_ROUND = 15;

// 单条消息最大工具调用次数
const MAX_TOOL_CALLS_PER_MESSAGE = 10;

// 清理会话控制器
function cleanupController(sessionId) {
  const controller = activeControllers.get(sessionId);
  if (controller) {
    controller.abort();
    activeControllers.delete(sessionId);
  }
}

// 生成会话名称
function generateSessionName(members) {
  if (members.length === 1) {
    return AGENT_INFO[members[0]].name;
  }
  return `群聊 (${members.map(m => AGENT_INFO[m].name).join('、')})`;
}

// 创建新会话
function createSession(userId, name, members) {
  const sessionId = randomUUID();
  const session = {
    id: sessionId,
    userId,
    name: name || generateSessionName(members),
    members, // 参与此会话的AI成员
    conversationHistory: [],
    agentSessions: {
      qwen: null,
      kimi: null,
      deepseek: null
    },
    mentionQueue: [],
    isProcessingQueue: false,
    currentRoundMessages: [],
    replyCountInRound: { qwen: 0, kimi: 0, deepseek: 0 },
    totalCallCount: 0, // 全局调用计数器
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  
  sessions.set(sessionId, session);
  
  // 添加到用户的会话列表
  if (!userSessions.has(userId)) {
    userSessions.set(userId, []);
  }
  userSessions.get(userId).unshift(sessionId);
  
  return session;
}

// 获取用户的会话列表
function getUserSessionList(userId) {
  const sessionIds = userSessions.get(userId) || [];
  return sessionIds.map(id => {
    const session = sessions.get(id);
    if (!session) return null;
    return {
      id: session.id,
      name: session.name,
      members: session.members,
      lastMessage: session.conversationHistory.length > 0 
        ? session.conversationHistory[session.conversationHistory.length - 1].content.substring(0, 50) + '...'
        : '暂无消息',
      updatedAt: session.updatedAt
    };
  }).filter(Boolean);
}

// 构建给 AI 的提示
function buildAgentPrompt(agentId, session) {
  const agentInfo = AGENT_INFO[agentId];
  const contextMessages = [...session.conversationHistory, ...session.currentRoundMessages];
  
  let prompt = `你是 ${agentInfo.name}（${agentInfo.realName}），来自 ${agentInfo.company} 的 AI 助手。

【你的身份】
- 名称：${agentInfo.name}
- 公司：${agentInfo.company}
- 角色：你是一个团队成员，正在与老板（用户）以及 ${session.members.filter(m => m !== agentId).map(m => AGENT_INFO[m].name).join('、')} 进行讨论。

【对用户的称呼】
请称呼用户为"老板"。

【当前群聊成员】
${session.members.map(m => `- ${AGENT_INFO[m].name} (${AGENT_INFO[m].company})`).join('\n')}

【对话上下文】
`;
  
  if (contextMessages.length === 0) {
    prompt += '（暂无）\n';
  } else {
    contextMessages.forEach((msg, idx) => {
      const speaker = msg.agentId === 'user' ? '老板' : AGENT_INFO[msg.agentId]?.name || msg.agentId;
      prompt += `${idx + 1}. ${speaker}: ${msg.content}\n`;
    });
  }
  
  prompt += `
【重要：@功能说明】
你可以在回复中使用 @提及 来邀请其他AI参与讨论：
${session.members.filter(m => m !== agentId).map(m => `- @${AGENT_INFO[m].name} - 邀请${AGENT_INFO[m].name}回答`).join('\n')}
- @所有人 - 邀请所有AI参与

请作为${agentInfo.name}用中文自然回复：`;
  
  return prompt;
}

/**
 * 安全地完成轮次并清理状态
 */
function safeFinishRound(session, sessionId) {
  // 只有队列为空且没有正在处理的任务时才真正完成
  if (session.mentionQueue.length > 0 || session.isProcessingQueue) {
    return false; // 还不能完成
  }
  
  finishRound(session);
  
  // 清理控制器
  cleanupController(sessionId);
  
  // 通知前端更新
  const socketId = Array.from(io.sockets.adapter.rooms.get(sessionId) || [])[0];
  if (socketId) {
    io.to(socketId).emit('waiting_for_user');
  }
  
  return true;
}

/**
 * 处理 AI 回复队列（增强安全版本）
 */
async function processMentionQueue(sessionId, io) {
  const session = sessions.get(sessionId);
  if (!session) return;
  
  // 检查是否应该停止
  const controller = activeControllers.get(sessionId);
  if (controller?.signal.aborted) {
    console.log(`[${sessionId}] 执行已取消，停止队列处理`);
    session.isProcessingQueue = false;
    cleanupController(sessionId);
    return;
  }
  
  // 队列为空时尝试完成轮次
  if (session.mentionQueue.length === 0) {
    safeFinishRound(session, sessionId);
    return;
  }
  
  // 防止并发处理
  if (session.isProcessingQueue) {
    return;
  }
  
  // 检查全局调用限制
  if (session.totalCallCount >= MAX_TOTAL_CALLS_PER_ROUND) {
    console.log(`[${sessionId}] 达到全局调用限制 (${MAX_TOTAL_CALLS_PER_ROUND})，强制结束本轮`);
    io.to(sessionId).emit('system_message', {
      type: 'limit_reached',
      message: `已达到本轮最大调用次数限制 (${MAX_TOTAL_CALLS_PER_ROUND})`
    });
    session.mentionQueue = []; // 清空队列
    safeFinishRound(session, sessionId);
    return;
  }
  
  session.isProcessingQueue = true;
  
  const agentId = session.mentionQueue.shift();
  
  // 检查该AI是否在此会话中
  if (!session.members.includes(agentId)) {
    session.isProcessingQueue = false;
    setTimeout(() => processMentionQueue(sessionId, io), 0);
    return;
  }
  
  const agent = agents[agentId];
  
  // 检查单个Agent的调用限制
  if (!agent || session.replyCountInRound[agentId] >= MAX_REPLY_PER_ROUND) {
    session.isProcessingQueue = false;
    setTimeout(() => processMentionQueue(sessionId, io), 0);
    return;
  }
  
  // 增加计数器
  session.replyCountInRound[agentId]++;
  session.totalCallCount++;
  
  io.to(sessionId).emit('typing', { agentId });
  
  try {
    const prompt = buildAgentPrompt(agentId, session);
    
    let messageContent = '';
    let mentionsInReply = [];
    let wasCancelled = false;
    
    for await (const event of agent.invoke(prompt, { 
      sessionId: session.agentSessions[agentId],
      signal: controller?.signal // 传递取消信号
    })) {
      // 检查是否被取消
      if (controller?.signal.aborted) {
        console.log(`[${sessionId}] Agent ${agentId} 执行被取消`);
        wasCancelled = true;
        break;
      }
      
      if (event.type === 'session_init') {
        session.agentSessions[agentId] = event.sessionId;
      }
      
      // 流式响应开始
      if (event.type === 'message_start') {
        io.to(sessionId).emit('message_start', {
          sessionId,
          agentId,
          timestamp: Date.now()
        });
      }
      
      // 流式内容增量
      if (event.type === 'message_delta') {
        messageContent = event.content;
        io.to(sessionId).emit('message_delta', {
          sessionId,
          agentId,
          content: event.content,
          delta: event.delta,
          timestamp: Date.now()
        });
      }
      
      // 完整消息（流式结束时）
      if (event.type === 'message') {
        messageContent = event.content;
        const mentionResult = parseMentions(messageContent);
        mentionsInReply = mentionResult.mentions;
        
        io.to(sessionId).emit('message', {
          sessionId,
          agentId,
          content: event.content,
          mentions: mentionsInReply,
          timestamp: Date.now()
        });
      }
      
      // 处理取消事件
      if (event.type === 'cancelled') {
        wasCancelled = true;
        break;
      }
      
      if (event.type === 'tool_call') {
        io.to(sessionId).emit('message', {
          sessionId,
          type: 'tool_call',
          agentId,
          tool: event.tool,
          params: event.params,
          timestamp: Date.now()
        });
      }
      
      if (event.type === 'tool_result') {
        io.to(sessionId).emit('message', {
          sessionId,
          type: 'tool_result',
          agentId,
          tool: event.tool,
          success: event.success,
          result: event.result,
          timestamp: Date.now()
        });
      }
      
      if (event.type === 'error') {
        io.to(sessionId).emit('error', { sessionId, agentId, error: event.error });
      }
    }
    
    // 如果被取消，不保存消息也不处理@
    if (!wasCancelled && messageContent) {
      session.currentRoundMessages.push({
        agentId,
        content: messageContent,
        timestamp: Date.now()
      });
      
      // 处理回复中的@
      if (mentionsInReply.length > 0) {
        const newMentions = mentionsInReply.filter(m => {
          if (!session.members.includes(m)) return false;
          if (session.mentionQueue.includes(m)) return false;
          if (session.replyCountInRound[m] >= MAX_REPLY_PER_ROUND) return false;
          return true;
        });
        
        if (newMentions.length > 0) {
          session.mentionQueue.push(...newMentions);
        }
      }
    }
    
  } catch (error) {
    console.error(`Error with ${agentId}:`, error);
    io.to(sessionId).emit('error', { sessionId, agentId, error: error.message });
  }
  
  session.isProcessingQueue = false;
  session.updatedAt = Date.now();
  
  // 继续处理队列（使用 setTimeout 避免阻塞）
  setTimeout(() => processMentionQueue(sessionId, io), 100);
}

function finishRound(session) {
  if (session.currentRoundMessages.length > 0) {
    session.conversationHistory.push(...session.currentRoundMessages);
    session.currentRoundMessages = [];
  }
  
  // 重置计数器
  session.replyCountInRound = { qwen: 0, kimi: 0, deepseek: 0 };
  session.totalCallCount = 0;
  session.updatedAt = Date.now();
  
  // 限制历史记录长度
  if (session.conversationHistory.length > 100) {
    session.conversationHistory = session.conversationHistory.slice(-100);
  }
}

// ============================================
// API 路由
// ============================================

// 获取用户的所有会话
app.get('/api/sessions', (req, res) => {
  const userId = req.headers['x-user-id'] || 'anonymous';
  const sessionList = getUserSessionList(userId);
  res.json({ sessions: sessionList });
});

// 创建新会话
app.post('/api/sessions', (req, res) => {
  const userId = req.headers['x-user-id'] || 'anonymous';
  const { name, members } = req.body;
  
  if (!members || members.length === 0) {
    return res.status(400).json({ error: '请至少选择一个AI成员' });
  }
  
  const session = createSession(userId, name, members);
  res.json({ 
    session: {
      id: session.id,
      name: session.name,
      members: session.members
    }
  });
});

// 获取会话详情
app.get('/api/sessions/:sessionId', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: '会话不存在' });
  }
  
  res.json({
    session: {
      id: session.id,
      name: session.name,
      members: session.members,
      history: session.conversationHistory
    }
  });
});

// 删除会话
app.delete('/api/sessions/:sessionId', (req, res) => {
  const userId = req.headers['x-user-id'] || 'anonymous';
  const sessionId = req.params.sessionId;
  const session = sessions.get(sessionId);
  
  if (!session) {
    return res.status(404).json({ error: '会话不存在' });
  }
  
  // 验证权限（只能删除自己的会话）
  if (session.userId !== userId) {
    return res.status(403).json({ error: '无权删除此会话' });
  }
  
  // 先取消正在进行的执行
  cleanupController(sessionId);
  
  // 从用户的会话列表中移除
  const userSessionList = userSessions.get(userId);
  if (userSessionList) {
    const index = userSessionList.indexOf(sessionId);
    if (index > -1) {
      userSessionList.splice(index, 1);
    }
  }
  
  // 删除会话
  sessions.delete(sessionId);
  
  res.json({ success: true });
});

// 获取所有可用的AI成员
app.get('/api/agents', (req, res) => {
  res.json({ agents: Object.values(AGENT_INFO) });
});

// ============================================
// 紧急停止 API（安全修复关键）
// ============================================

// 紧急停止会话中的所有执行
app.post('/api/sessions/:sessionId/stop', (req, res) => {
  const userId = req.headers['x-user-id'] || 'anonymous';
  const sessionId = req.params.sessionId;
  const session = sessions.get(sessionId);
  
  if (!session) {
    return res.status(404).json({ error: '会话不存在' });
  }
  
  // 验证权限
  if (session.userId !== userId) {
    return res.status(403).json({ error: '无权操作此会话' });
  }
  
  // 执行紧急停止
  const controller = activeControllers.get(sessionId);
  if (controller) {
    controller.abort();
    activeControllers.delete(sessionId);
    console.log(`[${sessionId}] 紧急停止已执行`);
  }
  
  // 清空队列
  session.mentionQueue = [];
  session.isProcessingQueue = false;
  
  // 通知前端
  io.to(sessionId).emit('execution_stopped', {
    message: '执行已被用户终止',
    timestamp: Date.now()
  });
  
  // 解锁输入
  io.to(sessionId).emit('waiting_for_user');
  
  res.json({ 
    success: true, 
    message: '执行已终止',
    stoppedAt: Date.now()
  });
});

// 管理员全局紧急停止（需要管理员密钥）
app.post('/api/admin/emergency-stop', (req, res) => {
  const { adminKey, sessionId } = req.body;
  
  // 简单的管理员验证（生产环境应使用更安全的验证）
  if (adminKey !== process.env.ADMIN_KEY) {
    return res.status(403).json({ error: '无效的管理员密钥' });
  }
  
  if (sessionId) {
    // 停止特定会话
    const controller = activeControllers.get(sessionId);
    if (controller) {
      controller.abort();
      activeControllers.delete(sessionId);
    }
    const session = sessions.get(sessionId);
    if (session) {
      session.mentionQueue = [];
      session.isProcessingQueue = false;
    }
    io.to(sessionId).emit('execution_stopped', {
      message: '执行已被管理员终止',
      timestamp: Date.now()
    });
  } else {
    // 停止所有会话
    for (const [sid, ctrl] of activeControllers) {
      ctrl.abort();
      const session = sessions.get(sid);
      if (session) {
        session.mentionQueue = [];
        session.isProcessingQueue = false;
      }
      io.to(sid).emit('execution_stopped', {
        message: '执行已被管理员全局终止',
        timestamp: Date.now()
      });
    }
    activeControllers.clear();
  }
  
  res.json({ 
    success: true, 
    message: sessionId ? '指定会话已终止' : '所有会话已终止'
  });
});

// ============================================
// Socket.io
// ============================================

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  const userId = socket.handshake.query.userId || 'anonymous';
  
  // 发送用户的会话列表
  const sessionList = getUserSessionList(userId);
  socket.emit('session_list', { sessions: sessionList });
  
  // 加入会话
  socket.on('join_session', (data) => {
    const { sessionId } = data;
    const session = sessions.get(sessionId);
    
    if (!session) {
      socket.emit('error', { error: '会话不存在' });
      return;
    }
    
    // 离开之前的会话房间
    socket.rooms.forEach(room => {
      if (room !== socket.id) {
        socket.leave(room);
      }
    });
    
    // 加入新会话
    socket.join(sessionId);
    
    // 发送会话历史
    socket.emit('session_joined', {
      session: {
        id: session.id,
        name: session.name,
        members: session.members,
        history: [...session.conversationHistory, ...session.currentRoundMessages]
      }
    });
  });
  
  // 处理用户消息
  socket.on('user_message', (data) => {
    const { sessionId, message } = data;
    const session = sessions.get(sessionId);
    
    if (!session) {
      socket.emit('error', { error: '会话不存在' });
      return;
    }
    
    // 清理之前的控制器（如果有）
    cleanupController(sessionId);
    
    // 创建新的控制器
    const controller = new AbortController();
    activeControllers.set(sessionId, controller);
    
    // 保存之前的轮次
    if (session.currentRoundMessages.length > 0) {
      session.conversationHistory.push(...session.currentRoundMessages);
      session.currentRoundMessages = [];
    }
    
    // 重置计数器
    session.replyCountInRound = { qwen: 0, kimi: 0, deepseek: 0 };
    session.totalCallCount = 0;
    
    // 保存用户消息
    session.conversationHistory.push({
      agentId: 'user',
      content: message,
      timestamp: Date.now()
    });
    
    // 广播用户消息
    io.to(sessionId).emit('message', {
      sessionId,
      agentId: 'user',
      content: message,
      timestamp: Date.now()
    });
    
    // 解析@
    const mentionResult = parseMentions(message);
    
    if (mentionResult.mentions.length > 0) {
      session.mentionQueue = mentionResult.mentions.filter(m => session.members.includes(m));
    } else {
      // 没有@，按成员顺序回复
      session.mentionQueue = [...session.members];
    }
    
    // 开始处理队列
    if (session.mentionQueue.length > 0) {
      processMentionQueue(sessionId, io);
    } else {
      socket.emit('waiting_for_user');
    }
    
    session.updatedAt = Date.now();
  });
  
  // 停止执行（前端紧急停止按钮）
  socket.on('stop_execution', (data) => {
    const { sessionId } = data;
    const session = sessions.get(sessionId);
    
    if (!session) {
      socket.emit('error', { error: '会话不存在' });
      return;
    }
    
    // 验证权限
    if (session.userId !== userId) {
      socket.emit('error', { error: '无权操作此会话' });
      return;
    }
    
    // 执行停止
    const controller = activeControllers.get(sessionId);
    if (controller) {
      controller.abort();
      activeControllers.delete(sessionId);
      console.log(`[${sessionId}] 执行已通过 Socket 停止`);
    }
    
    // 清空队列
    session.mentionQueue = [];
    session.isProcessingQueue = false;
    
    // 通知房间
    io.to(sessionId).emit('execution_stopped', {
      message: '执行已被用户终止',
      timestamp: Date.now()
    });
    
    io.to(sessionId).emit('waiting_for_user');
    
    socket.emit('stop_confirmed', { sessionId });
  });
  
  // 重命名会话
  socket.on('rename_session', (data) => {
    const { sessionId, name } = data;
    const session = sessions.get(sessionId);
    
    if (session) {
      session.name = name;
      session.updatedAt = Date.now();
      
      // 通知用户更新会话列表
      const sessionList = getUserSessionList(userId);
      socket.emit('session_list', { sessions: sessionList });
    }
  });
  
  // 断开连接
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    // 注意：用户断开时我们不自动取消执行
    // 这是设计选择：让用户可以离线等待结果
    // 如需断连自动取消，可在此遍历用户的所有会话并 cleanupController
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`🚀 AI Team Chat Server running on http://localhost:${PORT}`);
  console.log(`🔒 安全控制已启用:`);
  console.log(`   - 每轮每Agent最大调用: ${MAX_REPLY_PER_ROUND}`);
  console.log(`   - 每轮全局最大调用: ${MAX_TOTAL_CALLS_PER_ROUND}`);
  console.log(`   - 单条消息工具调用限制: ${MAX_TOOL_CALLS_PER_MESSAGE}`);
});
