import { TeamManager } from './team-manager.js';

async function main() {
  const teamManager = new TeamManager();
  
  // Example initial prompt - you can modify this or make it interactive
  const initialPrompt = "Let's solve this problem together as a team. We need to create a simple web application that displays the current weather for a user's location. How should we approach this task?";
  
  try {
    await teamManager.startTeamConversation(initialPrompt, 6);
    
    // Optionally save conversation to file
    const fs = await import('fs').then(m => m.promises);
    await fs.writeFile(
      'conversation-log.json', 
      JSON.stringify(teamManager.getConversationHistory(), null, 2)
    );
    console.log('\n📝 Conversation log saved to conversation-log.json');
    
  } catch (error) {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  }
}

// Run if called directly
if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch(console.error);
}

export { main };