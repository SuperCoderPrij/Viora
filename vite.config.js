import { defineConfig, loadEnv } from 'vite';
import { createChatHandler } from './src/server/gemini-chat.js';

function geminiChatPlugin(apiKey) {
  const handler = createChatHandler(apiKey);
  return {
    name: 'viora-gemini-chat',
    configureServer(server) {
      server.middlewares.use('/api/chat', handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/chat', handler);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return { plugins: [geminiChatPlugin(env.GEMINI_API_KEY)] };
});
