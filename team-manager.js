import { QwenAgent } from './agents/qwen-agent.js';
import { KimiAgent } from './agents/kimi-agent.js';
import { DeepSeekAgent } from './agents/deepseek-agent.js';

export class TeamManager {
  constructor() {
    this.agents = {
      qwen: new QwenAgent(),
      kimi: new KimiAgent(),
      deepseek: new DeepSeekAgent()
    };
    this.conversationHistory = [];
    this.activeSessions = new Map();
  }

  /**
   * Starts a team conversation with an initial prompt
   * @param {string} initialPrompt - The initial prompt to start the conversation
   * @param {number} [maxTurns=10] - Maximum number of conversation turns
   */
  async startTeamConversation(initialPrompt, maxTurns = 10) {
    console.log('🚀 Starting AI team conversation...');
    console.log(`Initial prompt: "${initialPrompt}"\n`);

    // Add initial prompt to history
    this.conversationHistory.push({
      type: 'message',
      agentId: 'user',
      content: initialPrompt,
      timestamp: Date.now()
    });

    let currentPrompt = initialPrompt;
    let turnCount = 0;

    // Rotate through agents for each turn
    const agentOrder = ['qwen', 'kimi', 'deepseek'];
    
    while (turnCount < maxTurns) {
      const currentAgentId = agentOrder[turnCount % agentOrder.length];
      const currentAgent = this.agents[currentAgentId];
      
      console.log(`👤 ${currentAgentId.toUpperCase()} is thinking...`);
      
      try {
        // Get session ID if we have one for this agent
        const sessionId = this.activeSessions.get(currentAgentId);
        
        // Invoke the agent
        for await (const event of currentAgent.invoke(currentPrompt, { sessionId })) {
          if (event.type === 'session_init') {
            this.activeSessions.set(currentAgentId, event.sessionId);
            console.log(`   Session initialized: ${event.sessionId}`);
          }
          
          if (event.type === 'message') {
            console.log(`💬 ${currentAgentId.toUpperCase()}: ${event.content}\n`);
            
            // Add to conversation history
            this.conversationHistory.push({
              type: 'message',
              agentId: currentAgentId,
              content: event.content,
              timestamp: event.timestamp
            });
            
            // Update current prompt for next agent
            currentPrompt = event.content;
          }
          
          if (event.type === 'error') {
            console.error(`❌ ${currentAgentId.toUpperCase()} error: ${event.error}`);
            break;
          }
        }
      } catch (error) {
        console.error(`❌ Error with ${currentAgentId}: ${error.message}`);
      }
      
      turnCount++;
      
      // Check if conversation should end naturally
      if (currentPrompt.toLowerCase().includes('conclusion') || 
          currentPrompt.toLowerCase().includes('final answer')) {
        console.log('🎯 Conversation reached natural conclusion.');
        break;
      }
    }
    
    console.log('🏁 Team conversation completed!');
    return this.conversationHistory;
  }

  /**
   * Gets the current conversation history
   * @returns {Array} Current conversation history
   */
  getConversationHistory() {
    return this.conversationHistory;
  }

  /**
   * Clears the conversation history and sessions
   */
  reset() {
    this.conversationHistory = [];
    this.activeSessions.clear();
  }
}