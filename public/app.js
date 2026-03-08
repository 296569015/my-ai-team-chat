// ===== 状态管理 =====
const state = {
  socket: null,
  userId: 'user_' + Math.random().toString(36).substr(2, 9),
  currentSessionId: null,
  sessions: [],
  agents: [],
  isWaiting: false,
  isExecuting: false, // 新增：是否正在执行
  mentionState: {
    isOpen: false,
    selectedIndex: 0,
    items: []
  },
  selectedAgents: new Set()
};

// ===== DOM 元素 =====
const elements = {
  sessionList: document.getElementById('sessionList'),
  messagesContainer: document.getElementById('messagesContainer'),
  emptyState: document.getElementById('emptyState'),
  inputArea: document.getElementById('inputArea'),
  messageInput: document.getElementById('messageInput'),
  btnSend: document.getElementById('btnSend'),
  btnNewChat: document.getElementById('btnNewChat'),
  chatTitle: document.getElementById('chatTitle'),
  chatSubtitle: document.getElementById('chatSubtitle'),
  membersBar: document.getElementById('membersBar'),
  memberList: document.getElementById('memberList'),
  currentSessionInfo: document.getElementById('currentSessionInfo'),
  typingIndicator: document.getElementById('typingIndicator'),
  
  // 停止按钮（新增）
  stopIndicator: document.getElementById('stopIndicator'),
  btnStop: document.getElementById('btnStop'),
  
  // 弹窗
  newChatModal: document.getElementById('newChatModal'),
  agentSelectList: document.getElementById('agentSelectList'),
  sessionNameInput: document.getElementById('sessionNameInput'),
  btnCreate: document.getElementById('btnCreate'),
  btnCancel: document.getElementById('btnCancel'),
  btnCloseModal: document.getElementById('btnCloseModal'),
  
  // 重命名弹窗
  renameModal: document.getElementById('renameModal'),
  renameInput: document.getElementById('renameInput'),
  btnConfirmRename: document.getElementById('btnConfirmRename'),
  btnCancelRename: document.getElementById('btnCancelRename'),
  btnCloseRenameModal: document.getElementById('btnCloseRenameModal'),
  
  // 其他按钮
  btnRename: document.getElementById('btnRename'),
  btnClearChat: document.getElementById('btnClearChat'),
  btnToggleSidebar: document.getElementById('btnToggleSidebar'),
  
  // @弹框
  mentionPopup: document.getElementById('mentionPopup'),
  mentionPopupList: document.getElementById('mentionPopupList')
};

// ===== AI 成员配置 =====
const agentConfig = {
  qwen: { id: 'qwen', name: '小千', realName: '千问', icon: '🤖', color: '#f59e0b', desc: '阿里云，代码生成' },
  kimi: { id: 'kimi', name: '小K', realName: 'Kimi', icon: '🌙', color: '#8b5cf6', desc: '月之暗面，长文本' },
  deepseek: { id: 'deepseek', name: '小D', realName: 'DeepSeek', icon: '🔍', color: '#3b82f6', desc: '推理分析' }
};

// ===== 初始化 =====
async function init() {
  // 加载AI列表
  await loadAgents();
  
  // 初始化Socket
  initSocket();
  
  // 绑定事件
  bindEvents();
  
  // 加载会话列表
  await loadSessions();
}

async function loadAgents() {
  try {
    const res = await fetch('/api/agents');
    const data = await res.json();
    state.agents = data.agents;
  } catch (err) {
    console.error('加载AI列表失败:', err);
  }
}

async function loadSessions() {
  try {
    const res = await fetch('/api/sessions', {
      headers: { 'X-User-Id': state.userId }
    });
    const data = await res.json();
    state.sessions = data.sessions;
    renderSessionList();
  } catch (err) {
    console.error('加载会话列表失败:', err);
  }
}

function initSocket() {
  state.socket = io({ query: { userId: state.userId } });
  
  state.socket.on('connect', () => {
    console.log('Connected to server');
  });
  
  state.socket.on('session_list', (data) => {
    state.sessions = data.sessions;
    renderSessionList();
  });
  
  state.socket.on('session_joined', (data) => {
    loadSession(data.session);
  });
  
  // 流式响应开始
  state.socket.on('message_start', (data) => {
    if (data.sessionId === state.currentSessionId) {
      hideTyping();
      appendStreamingMessage(data.agentId);
      showStopButton(); // 显示停止按钮
    }
  });
  
  // 流式内容增量
  state.socket.on('message_delta', (data) => {
    if (data.sessionId === state.currentSessionId) {
      updateStreamingMessage(data.agentId, data.content);
    }
  });
  
  // 完整消息（流式结束时）
  state.socket.on('message', (data) => {
    if (data.sessionId === state.currentSessionId) {
      finalizeStreamingMessage(data);
    }
  });
  
  state.socket.on('typing', (data) => {
    if (data.sessionId === state.currentSessionId) {
      showTyping(data.agentId);
      showStopButton(); // 显示停止按钮
    }
  });
  
  // 等待用户输入（执行结束）
  state.socket.on('waiting_for_user', () => {
    state.isWaiting = false;
    state.isExecuting = false;
    hideTyping();
    hideStopButton(); // 隐藏停止按钮
    updateInputState();
  });
  
  // 执行被停止
  state.socket.on('execution_stopped', (data) => {
    state.isWaiting = false;
    state.isExecuting = false;
    hideTyping();
    hideStopButton();
    updateInputState();
    
    // 显示系统消息
    if (data.sessionId === state.currentSessionId) {
      appendSystemMessage(data.message, 'info');
    }
  });
  
  // 系统消息
  state.socket.on('system_message', (data) => {
    if (data.sessionId === state.currentSessionId) {
      appendSystemMessage(data.message, data.type || 'info');
    }
  });
  
  // @通知事件已移除
  
  state.socket.on('error', (data) => {
    console.error('Socket error:', data);
    // 如果是当前会话的错误，显示在界面上
    if (data.sessionId === state.currentSessionId) {
      appendSystemMessage('错误: ' + data.error, 'error');
    }
    alert('错误: ' + data.error);
  });
}

// ===== 渲染函数 =====

function renderSessionList() {
  elements.sessionList.innerHTML = '';
  
  if (state.sessions.length === 0) {
    elements.sessionList.innerHTML = '<div class="empty-text" style="padding: 20px; color: #94a3b8; text-align: center;">暂无会话</div>';
    return;
  }
  
  state.sessions.forEach(session => {
    const item = document.createElement('div');
    item.className = 'session-item' + (session.id === state.currentSessionId ? ' active' : '');
    
    // 头像组
    const avatarsHtml = session.members.slice(0, 3).map((m, i) => {
      const config = agentConfig[m];
      return `<div class="session-avatar" style="background: ${config.color}; z-index: ${3-i}">${config.icon}</div>`;
    }).join('');
    
    item.innerHTML = `
      <div class="session-content" onclick="window.joinSession('${session.id}')">
        <div class="session-avatars">${avatarsHtml}</div>
        <div class="session-info">
          <div class="session-name">${session.name}</div>
          <div class="session-preview">${session.lastMessage || '暂无消息'}</div>
        </div>
      </div>
      <div class="session-actions">
        <button class="session-btn rename" onclick="window.openRenameSessionModal('${session.id}', event)" title="重命名">
          <i class="fas fa-pen"></i>
        </button>
        <button class="session-btn delete" onclick="window.deleteSession('${session.id}', event)" title="删除">
          <i class="fas fa-times"></i>
        </button>
      </div>
    `;
    
    elements.sessionList.appendChild(item);
  });
}

function renderMembersBar(members) {
  elements.membersBar.innerHTML = members.map(id => {
    const config = agentConfig[id];
    return `
      <div class="member-chip">
        <div class="member-chip-avatar" style="background: ${config.color}">${config.icon}</div>
        <span>${config.name}</span>
      </div>
    `;
  }).join('');
}

function renderMemberList(members) {
  elements.memberList.innerHTML = members.map(id => {
    const config = agentConfig[id];
    return `
      <div class="member-item">
        <div class="member-item-avatar" style="background: ${config.color}">${config.icon}</div>
        <div class="member-item-info">
          <div class="member-item-name">${config.name}</div>
          <div class="member-item-role">${config.desc}</div>
        </div>
      </div>
    `;
  }).join('');
}

// ===== 会话操作 =====

async function createNewSession() {
  const members = Array.from(state.selectedAgents);
  if (members.length === 0) return;
  
  const name = elements.sessionNameInput.value.trim();
  
  try {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': state.userId
      },
      body: JSON.stringify({ name, members })
    });
    
    const data = await res.json();
    
    closeNewChatModal();
    joinSession(data.session.id);
    
    // 刷新列表
    await loadSessions();
  } catch (err) {
    console.error('创建会话失败:', err);
    alert('创建会话失败');
  }
}

function joinSession(sessionId) {
  state.currentSessionId = sessionId;
  state.socket.emit('join_session', { sessionId });
  renderSessionList(); // 更新激活状态
}

function loadSession(session) {
  // 更新UI
  elements.emptyState.style.display = 'none';
  elements.inputArea.style.display = 'block';
  
  elements.chatTitle.textContent = session.name;
  elements.chatSubtitle.textContent = `${session.members.length} 位成员`;
  
  renderMembersBar(session.members);
  renderMemberList(session.members);
  
  // 更新右侧信息
  elements.currentSessionInfo.innerHTML = `
    <div class="session-meta">
      <div class="session-meta-name">${session.name}</div>
      <div class="session-meta-members">${session.members.map(m => agentConfig[m].name).join('、')}</div>
    </div>
  `;
  
  // 渲染历史消息
  elements.messagesContainer.innerHTML = '';
  if (session.history && session.history.length > 0) {
    session.history.forEach(msg => appendMessage(msg));
  }
  
  // 滚动到底部
  scrollToBottom();
}

// ===== 消息处理 =====

// 存储正在流式显示的消息元素
const streamingMessages = {};

function appendStreamingMessage(agentId) {
  const config = agentConfig[agentId];
  const msg = document.createElement('div');
  msg.className = 'message streaming';
  msg.id = `streaming-${agentId}`;
  
  const avatarHtml = `<div class="message-avatar" style="background: ${config.color}">${config.icon}</div>`;
  const authorName = config.name;
  const timeStr = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  
  msg.innerHTML = `
    ${avatarHtml}
    <div class="message-content">
      <div class="message-header">
        <span class="message-author">${authorName}</span>
        <span class="message-time">${timeStr}</span>
        <span class="streaming-indicator">●</span>
      </div>
      <div class="message-text"></div>
    </div>
  `;
  
  elements.messagesContainer.appendChild(msg);
  streamingMessages[agentId] = msg;
  scrollToBottom();
}

function updateStreamingMessage(agentId, content) {
  const msg = streamingMessages[agentId];
  if (!msg) return;
  
  const textEl = msg.querySelector('.message-text');
  
  // 处理@高亮
  let contentHtml = escapeHtml(content);
  contentHtml = contentHtml.replace(/@([\u4e00-\u9fa5a-zA-Z]+)/g, (match, name) => {
    const agent = Object.values(agentConfig).find(a => a.name === name);
    if (agent) {
      return `<span style="color: ${agent.color}; font-weight: 600;">${match}</span>`;
    }
    return match;
  });
  
  textEl.innerHTML = contentHtml;
  scrollToBottom();
}

function finalizeStreamingMessage(data) {
  const agentId = data.agentId;
  const msg = streamingMessages[agentId];
  
  if (msg) {
    // 移除流式标记和指示器
    msg.classList.remove('streaming');
    const indicator = msg.querySelector('.streaming-indicator');
    if (indicator) indicator.remove();
    
    // 更新最终内容
    updateStreamingMessage(agentId, data.content);
    
    // 清理引用
    delete streamingMessages[agentId];
  } else {
    // 如果没有找到流式消息，创建普通消息
    appendMessage(data);
  }
}

function appendMessage(data) {
  const msg = document.createElement('div');
  msg.className = 'message' + (data.agentId === 'user' ? ' user' : '');
  
  const isUser = data.agentId === 'user';
  const config = isUser ? null : agentConfig[data.agentId];
  
  const avatarHtml = isUser 
    ? '<div class="message-avatar" style="background: linear-gradient(135deg, #10b981, #059669)"><i class="fas fa-user"></i></div>'
    : `<div class="message-avatar" style="background: ${config.color}">${config.icon}</div>`;
  
  const authorName = isUser ? '老板' : (config?.name || 'AI');
  const timeStr = new Date(data.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  
  // 处理@高亮
  let contentHtml = escapeHtml(data.content || '');
  contentHtml = contentHtml.replace(/@([\u4e00-\u9fa5a-zA-Z]+)/g, (match, name) => {
    const agent = Object.values(agentConfig).find(a => a.name === name);
    if (agent) {
      return `<span style="color: ${agent.color}; font-weight: 600;">${match}</span>`;
    }
    return match;
  });
  
  msg.innerHTML = `
    ${avatarHtml}
    <div class="message-content">
      <div class="message-header">
        <span class="message-author">${authorName}</span>
        <span class="message-time">${timeStr}</span>
      </div>
      <div class="message-text">${contentHtml}</div>
    </div>
  `;
  
  elements.messagesContainer.appendChild(msg);
  scrollToBottom();
}

// 新增：添加系统消息
function appendSystemMessage(message, type = 'info') {
  const msg = document.createElement('div');
  msg.className = `system-message ${type}`;
  
  const icon = type === 'error' ? 'fa-exclamation-circle' : 
               type === 'warning' ? 'fa-exclamation-triangle' : 
               'fa-info-circle';
  
  msg.innerHTML = `
    <i class="fas ${icon}"></i>
    <span>${escapeHtml(message)}</span>
  `;
  
  elements.messagesContainer.appendChild(msg);
  scrollToBottom();
  
  // 3秒后自动消失（可选）
  setTimeout(() => {
    msg.style.opacity = '0';
    msg.style.transition = 'opacity 0.5s';
    setTimeout(() => msg.remove(), 500);
  }, 5000);
}

// @通知已移除，不再显示

function showTyping(agentId) {
  const config = agentConfig[agentId];
  elements.typingIndicator.querySelector('.typing-text').innerHTML = 
    `<span style="color: ${config.color}">${config.name}</span> 正在思考...`;
  elements.typingIndicator.classList.add('show');
}

function hideTyping() {
  elements.typingIndicator.classList.remove('show');
}

// 新增：显示/隐藏停止按钮
function showStopButton() {
  state.isExecuting = true;
  elements.stopIndicator.style.display = 'flex';
  elements.stopIndicator.classList.add('show');
}

function hideStopButton() {
  state.isExecuting = false;
  elements.stopIndicator.classList.remove('show');
  setTimeout(() => {
    if (!state.isExecuting) {
      elements.stopIndicator.style.display = 'none';
    }
  }, 300);
}

// 新增：停止执行
async function stopExecution() {
  if (!state.currentSessionId || !state.isExecuting) return;
  
  // 通过 Socket 发送停止命令
  state.socket.emit('stop_execution', {
    sessionId: state.currentSessionId
  });
  
  // 立即更新 UI（乐观更新）
  state.isWaiting = false;
  state.isExecuting = false;
  hideTyping();
  hideStopButton();
  updateInputState();
  
  // 显示系统消息
  appendSystemMessage('正在停止...', 'info');
}

function sendMessage() {
  const text = elements.messageInput.value.trim();
  if (!text || !state.currentSessionId || state.isWaiting) return;
  
  state.isWaiting = true;
  state.isExecuting = true;
  updateInputState();
  
  state.socket.emit('user_message', {
    sessionId: state.currentSessionId,
    message: text
  });
  
  elements.messageInput.value = '';
  elements.messageInput.style.height = 'auto';
  closeMentionPopup();
}

// ===== @功能 =====

function handleInput() {
  const text = elements.messageInput.value;
  const cursorPos = elements.messageInput.selectionStart;
  const textBeforeCursor = text.substring(0, cursorPos);
  
  // 自动调整高度
  elements.messageInput.style.height = 'auto';
  elements.messageInput.style.height = Math.min(elements.messageInput.scrollHeight, 120) + 'px';
  
  // 检查@
  const lastAtIndex = textBeforeCursor.lastIndexOf('@');
  if (lastAtIndex === -1) {
    closeMentionPopup();
    return;
  }
  
  const textAfterAt = textBeforeCursor.substring(lastAtIndex + 1);
  if (textAfterAt.includes(' ') || textAfterAt.includes('\n')) {
    closeMentionPopup();
    return;
  }
  
  // 获取当前会话的成员
  const currentSession = state.sessions.find(s => s.id === state.currentSessionId);
  if (!currentSession) return;
  
  // 打开@弹框
  openMentionPopup(currentSession.members, lastAtIndex);
}

function openMentionPopup(members, startPos) {
  state.mentionState.isOpen = true;
  state.mentionState.startPos = startPos;
  state.mentionState.selectedIndex = 0;
  state.mentionState.items = members;
  
  elements.mentionPopupList.innerHTML = members.map((id, index) => {
    const config = agentConfig[id];
    return `
      <div class="mention-popup-item ${index === 0 ? 'selected' : ''}" data-index="${index}">
        <div class="mention-popup-avatar" style="background: ${config.color}">${config.icon}</div>
        <div>${config.name}</div>
      </div>
    `;
  }).join('');
  
  // 绑定点击事件
  elements.mentionPopupList.querySelectorAll('.mention-popup-item').forEach(item => {
    item.onclick = () => selectMention(parseInt(item.dataset.index));
  });
  
  elements.mentionPopup.classList.add('show');
}

function closeMentionPopup() {
  state.mentionState.isOpen = false;
  elements.mentionPopup.classList.remove('show');
}

function selectMention(index) {
  const memberId = state.mentionState.items[index];
  const config = agentConfig[memberId];
  const mentionText = `@${config.name} `;
  
  const currentValue = elements.messageInput.value;
  const before = currentValue.substring(0, state.mentionState.startPos);
  const after = currentValue.substring(elements.messageInput.selectionStart);
  
  elements.messageInput.value = before + mentionText + after;
  
  const newPos = state.mentionState.startPos + mentionText.length;
  elements.messageInput.setSelectionRange(newPos, newPos);
  elements.messageInput.focus();
  
  closeMentionPopup();
}

function handleKeydown(e) {
  if (!state.mentionState.isOpen) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
    return;
  }
  
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      state.mentionState.selectedIndex = (state.mentionState.selectedIndex + 1) % state.mentionState.items.length;
      updateMentionSelection();
      break;
    case 'ArrowUp':
      e.preventDefault();
      state.mentionState.selectedIndex = (state.mentionState.selectedIndex - 1 + state.mentionState.items.length) % state.mentionState.items.length;
      updateMentionSelection();
      break;
    case 'Enter':
    case 'Tab':
      e.preventDefault();
      selectMention(state.mentionState.selectedIndex);
      break;
    case 'Escape':
      closeMentionPopup();
      break;
  }
}

function updateMentionSelection() {
  elements.mentionPopupList.querySelectorAll('.mention-popup-item').forEach((item, i) => {
    item.classList.toggle('selected', i === state.mentionState.selectedIndex);
  });
}

// ===== 弹窗功能 =====

function openNewChatModal() {
  state.selectedAgents.clear();
  elements.sessionNameInput.value = '';
  elements.btnCreate.disabled = true;
  
  // 渲染AI选项
  elements.agentSelectList.innerHTML = Object.values(agentConfig).map(agent => `
    <div class="agent-option" data-id="${agent.id}" onclick="toggleAgentSelection('${agent.id}')">
      <div class="agent-option-avatar" style="background: ${agent.color}">${agent.icon}</div>
      <div class="agent-option-info">
        <div class="agent-option-name">${agent.name}</div>
        <div class="agent-option-desc">${agent.desc}</div>
      </div>
      <div class="agent-option-check"><i class="fas fa-check"></i></div>
    </div>
  `).join('');
  
  elements.newChatModal.classList.add('show');
}

function closeNewChatModal() {
  elements.newChatModal.classList.remove('show');
}

function toggleAgentSelection(agentId) {
  const option = document.querySelector(`.agent-option[data-id="${agentId}"]`);
  
  if (state.selectedAgents.has(agentId)) {
    state.selectedAgents.delete(agentId);
    option.classList.remove('selected');
  } else {
    state.selectedAgents.add(agentId);
    option.classList.add('selected');
  }
  
  elements.btnCreate.disabled = state.selectedAgents.size === 0;
  
  // 如果只有一个选中，自动填充名称
  if (state.selectedAgents.size === 1 && !elements.sessionNameInput.value) {
    const singleAgent = agentConfig[Array.from(state.selectedAgents)[0]];
    elements.sessionNameInput.value = singleAgent.name;
  }
}

let renamingSessionId = null;

function openRenameModal() {
  if (!state.currentSessionId) return;
  openRenameSessionModal(state.currentSessionId);
}

function openRenameSessionModal(sessionId, event) {
  if (event) event.stopPropagation();
  
  renamingSessionId = sessionId;
  const session = state.sessions.find(s => s.id === sessionId);
  if (session) {
    elements.renameInput.value = session.name;
    elements.renameModal.classList.add('show');
  }
}

function closeRenameModal() {
  elements.renameModal.classList.remove('show');
}

function confirmRename() {
  const newName = elements.renameInput.value.trim();
  if (!newName || !renamingSessionId) return;
  
  state.socket.emit('rename_session', {
    sessionId: renamingSessionId,
    name: newName
  });
  
  // 如果是当前会话，更新标题
  if (renamingSessionId === state.currentSessionId) {
    elements.chatTitle.textContent = newName;
  }
  
  renamingSessionId = null;
  closeRenameModal();
}

async function deleteSession(sessionId, event) {
  if (event) event.stopPropagation();
  
  const session = state.sessions.find(s => s.id === sessionId);
  if (!session) return;
  
  if (!confirm(`确定要删除会话 "${session.name}" 吗？`)) return;
  
  try {
    const res = await fetch(`/api/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: { 'X-User-Id': state.userId }
    });
    
    if (res.ok) {
      // 如果删除的是当前会话，清空聊天区域
      if (sessionId === state.currentSessionId) {
        state.currentSessionId = null;
        state.isWaiting = false;
        state.isExecuting = false;
        hideStopButton();
        elements.messagesContainer.innerHTML = `
          <div class="empty-state" id="emptyState">
            <div class="empty-icon"><i class="fas fa-comments"></i></div>
            <h3>开始一个新的对话</h3>
            <p>点击"新对话"创建群聊，或选择左侧的历史会话</p>
          </div>
        `;
        elements.inputArea.style.display = 'none';
        elements.emptyState.style.display = 'flex';
        elements.chatTitle.textContent = '选择一个会话';
        elements.chatSubtitle.textContent = '点击左侧会话开始聊天';
        elements.membersBar.innerHTML = '';
        elements.memberList.innerHTML = '';
        elements.currentSessionInfo.innerHTML = '<div class="empty-text">未选择会话</div>';
      }
      
      // 刷新列表
      await loadSessions();
    }
  } catch (err) {
    console.error('删除会话失败:', err);
    alert('删除失败');
  }
}

// ===== 工具函数 =====

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function scrollToBottom() {
  elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
}

function updateInputState() {
  elements.btnSend.disabled = state.isWaiting;
  elements.messageInput.disabled = state.isWaiting;
}

// ===== 事件绑定 =====

function bindEvents() {
  // 新对话
  elements.btnNewChat.onclick = openNewChatModal;
  elements.btnCancel.onclick = closeNewChatModal;
  elements.btnCloseModal.onclick = closeNewChatModal;
  elements.btnCreate.onclick = createNewSession;
  
  // 重命名
  elements.btnRename.onclick = openRenameModal;
  elements.btnCancelRename.onclick = closeRenameModal;
  elements.btnCloseRenameModal.onclick = closeRenameModal;
  elements.btnConfirmRename.onclick = confirmRename;
  
  // 发送消息
  elements.btnSend.onclick = sendMessage;
  elements.messageInput.oninput = handleInput;
  elements.messageInput.onkeydown = handleKeydown;
  
  // 停止按钮（新增）
  elements.btnStop.onclick = stopExecution;
  
  // 侧边栏切换
  elements.btnToggleSidebar.onclick = () => {
    document.querySelector('.sidebar-left').classList.toggle('show');
  };
  
  // 清空聊天记录
  elements.btnClearChat.onclick = () => {
    if (!state.currentSessionId) return;
    if (confirm('确定要清空当前聊天记录吗？')) {
      elements.messagesContainer.innerHTML = '';
    }
  };
  
  // 点击弹框外部关闭
  elements.newChatModal.onclick = (e) => {
    if (e.target === elements.newChatModal) closeNewChatModal();
  };
  elements.renameModal.onclick = (e) => {
    if (e.target === elements.renameModal) closeRenameModal();
  };
}

// 全局函数（供HTML调用）
window.toggleAgentSelection = toggleAgentSelection;
window.joinSession = joinSession;
window.deleteSession = deleteSession;
window.openRenameSessionModal = openRenameSessionModal;

// 启动
init();
