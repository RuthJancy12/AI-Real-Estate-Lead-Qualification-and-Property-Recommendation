import { detectChatIntent } from './src/utils/chatIntent.ts';

const text = "I want to buy A2 BHK apartment in Dubai.";
const res = detectChatIntent(text, {
  hasPropertyContext: false,
  turnCount: 3,
  userName: null
});
console.log("detectChatIntent result:", JSON.stringify(res, null, 2));
