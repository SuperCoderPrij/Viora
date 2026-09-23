const menuButton = document.querySelector('#menu-toggle');
const mobileMenu = document.querySelector('#mobile-menu');
const menuIcon = document.querySelector('#menu-icon');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const chatLauncher = document.querySelector('#chat-launcher');
const chatPanel = document.querySelector('#viora-chat-panel');
const chatClose = document.querySelector('#chat-close');
const chatForm = document.querySelector('#chat-form');
const chatInput = document.querySelector('#chat-input');
const chatSend = document.querySelector('#chat-send');
const chatMessages = document.querySelector('#chat-messages');
const chatHistory = [];

function setMenuOpen(isOpen) {
  mobileMenu.classList.toggle('hidden', !isOpen);
  menuButton.setAttribute('aria-expanded', String(isOpen));
  menuButton.setAttribute('aria-label', isOpen ? 'Close navigation' : 'Open navigation');
  menuIcon.innerHTML = isOpen
    ? '<path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'
    : '<path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>';
}

menuButton.addEventListener('click', () => {
  setMenuOpen(menuButton.getAttribute('aria-expanded') !== 'true');
});

mobileMenu.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => setMenuOpen(false));
});

function scrollToTarget(target, duration = 850) {
  const startY = window.scrollY;
  const endY = Math.max(0, startY + target.getBoundingClientRect().top - 24);

  if (reduceMotion.matches) {
    window.scrollTo({ top: endY, behavior: 'instant' });
    return;
  }

  const distance = endY - startY;
  const animationDuration = Math.min(1250, Math.max(duration, Math.abs(distance) * 0.45));
  let startTime;

  function animate(time) {
    startTime ??= time;
    const progress = Math.min((time - startTime) / animationDuration, 1);
    const easedProgress = progress < 0.5
      ? 4 * progress ** 3
      : 1 - ((-2 * progress + 2) ** 3) / 2;

    window.scrollTo({ top: startY + distance * easedProgress, behavior: 'instant' });
    if (progress < 1) requestAnimationFrame(animate);
  }

  requestAnimationFrame(animate);
}

document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener('click', (event) => {
    const target = document.getElementById(decodeURIComponent(link.hash.slice(1)));
    if (!target) return;

    event.preventDefault();
    if (window.location.hash !== link.hash) history.pushState(null, '', link.hash);
    scrollToTarget(target);
  });
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    setMenuOpen(false);
    if (!chatPanel.hidden) setChatOpen(false, true);
  }
});

document.querySelector('#year').textContent = new Date().getFullYear();

function setChatOpen(isOpen, restoreFocus = false) {
  chatPanel.hidden = !isOpen;
  chatLauncher.setAttribute('aria-expanded', String(isOpen));
  chatLauncher.setAttribute('aria-label', isOpen ? 'Close Viora assistant' : 'Open Viora assistant');

  if (isOpen) chatInput.focus();
  else if (restoreFocus) chatLauncher.focus();
}

chatLauncher.addEventListener('click', () => setChatOpen(chatPanel.hidden));
chatClose.addEventListener('click', () => setChatOpen(false, true));

function appendChatMessage(role, text, { typing = false } = {}) {
  const message = document.createElement('div');
  message.className = `chat-message ${role === 'user' ? 'user-message' : 'assistant-message'}`;

  if (role !== 'user') {
    const avatar = document.createElement('span');
    avatar.className = 'message-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = 'v';
    message.append(avatar);
  }

  const content = document.createElement('div');
  content.className = 'message-content';
  const paragraph = document.createElement('p');
  paragraph.textContent = text;
  if (typing) paragraph.classList.add('chat-typing');
  content.append(paragraph);

  if (!typing) {
    const time = document.createElement('time');
    time.dateTime = new Date().toISOString();
    time.textContent = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date());
    content.append(time);
  }

  message.append(content);
  chatMessages.append(message);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return message;
}

async function requestAssistantReply(message) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 55_000);

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history: chatHistory.slice(-10) }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'The assistant could not respond. Please try again.');
    }
    const data = await response.json();
    if (typeof data.reply !== 'string' || !data.reply.trim()) throw new Error('Chat service returned no reply');
    return data.reply.trim();
  } finally {
    window.clearTimeout(timeout);
  }
}

async function sendChatMessage(message) {
  const cleanMessage = message.trim();
  if (!cleanMessage || chatSend.disabled) return;

  chatMessages.querySelector('.chat-prompts')?.remove();
  appendChatMessage('user', cleanMessage);
  chatInput.value = '';
  chatInput.style.height = 'auto';
  chatInput.disabled = true;
  chatSend.disabled = true;
  const typingMessage = appendChatMessage('assistant', 'Thinking', { typing: true });

  try {
    const reply = await requestAssistantReply(cleanMessage);
    typingMessage.remove();
    appendChatMessage('assistant', reply);
    chatHistory.push({ role: 'user', content: cleanMessage }, { role: 'assistant', content: reply });
  } catch (error) {
    typingMessage.remove();
    const message = error.name === 'AbortError'
      ? 'That took too long. Please try again.'
      : error instanceof TypeError
        ? 'I couldn’t reach the chat service. Check that the Viora server is running, then try again.'
        : error.message;
    appendChatMessage('assistant', message || 'I couldn’t answer just now. Please try again.');
  } finally {
    chatInput.disabled = false;
    chatSend.disabled = false;
    chatInput.focus();
  }
}

chatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  sendChatMessage(chatInput.value);
});

chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = `${Math.min(chatInput.scrollHeight, 110)}px`;
});

chatInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

chatMessages.querySelectorAll('[data-chat-prompt]').forEach((button) => {
  button.addEventListener('click', () => sendChatMessage(button.dataset.chatPrompt));
});

window.vioraChatInitialized = true;
