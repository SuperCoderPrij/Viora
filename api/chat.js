import { createChatHandler } from '../src/server/gemini-chat.js';

export default createChatHandler(process.env.GEMINI_API_KEY);
