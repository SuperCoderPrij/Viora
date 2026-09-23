const MODEL = 'gemini-3.8-flash';
const FALLBACK_MODEL = 'gemini-3.5-flash';
const MAX_BODY_BYTES = 16 * 1024;
const MAX_MESSAGE_LENGTH = 1200;
const MAX_HISTORY_ITEMS = 10;
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

const systemInstruction = `You are Viora, a friendly educational wellness assistant for the Viora project.
Explain general wellness concepts in clear, calm language. You may explain what the Viora prototypes are designed to explore: an ESP32 with a MAX30100 optical heart-rate sensor, and an ESP32 with a BMI160 motion sensor for step-count experiments.
Never diagnose, claim to detect a condition, recommend medication or treatment, or present prototype readings as medically accurate. Do not claim access to a user's sensor data. Explain uncertainty and encourage a qualified healthcare professional for personal medical concerns. For possible emergencies, advise contacting local emergency services immediately. Do not ask for identifying or sensitive personal information. Keep answers concise and remind users when a question needs professional medical advice.`;

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  if (request.body !== undefined) {
    const serialized = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
    if (Buffer.byteLength(serialized ?? '') > MAX_BODY_BYTES) {
      const error = new Error('Request is too large.');
      error.status = 413;
      throw error;
    }
    try {
      return typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
    } catch {
      const error = new Error('Invalid JSON.');
      error.status = 400;
      throw error;
    }
  }

  let body = '';
  let size = 0;
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk);
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Request is too large.');
      error.status = 413;
      throw error;
    }
    body += chunk;
  }

  try {
    return JSON.parse(body);
  } catch {
    const error = new Error('Invalid JSON.');
    error.status = 400;
    throw error;
  }
}

function cleanHistory(value) {
  if (!Array.isArray(value)) return [];

  return value.slice(-MAX_HISTORY_ITEMS).flatMap((item) => {
    if (!item || !['user', 'assistant'].includes(item.role) || typeof item.content !== 'string') return [];
    const content = item.content.trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!content) return [];
    return [{
      role: item.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: content }],
    }];
  });
}

export function createChatHandler(apiKey) {
  const requestCounts = new Map();

  return async (request, response) => {
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      return sendJson(response, 405, { error: 'Use POST to send a chat message.' });
    }

    if (!apiKey) return sendJson(response, 503, { error: 'Gemini is not configured on the server.' });

    const now = Date.now();
    const address = request.socket?.remoteAddress || 'local';
    const recent = (requestCounts.get(address) || []).filter((time) => now - time < RATE_WINDOW_MS);
    if (recent.length >= RATE_LIMIT) return sendJson(response, 429, { error: 'Please wait a moment before sending more messages.' });
    recent.push(now);
    requestCounts.set(address, recent);

    try {
      const body = await readJson(request);
      const message = typeof body?.message === 'string' ? body.message.trim() : '';
      if (!message || message.length > MAX_MESSAGE_LENGTH) {
        return sendJson(response, 400, { error: `Message must be between 1 and ${MAX_MESSAGE_LENGTH} characters.` });
      }

      const contents = cleanHistory(body.history);
      contents.push({ role: 'user', parts: [{ text: message }] });

      const requestBody = JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents,
        generationConfig: { temperature: 0.4, maxOutputTokens: 700 },
      });
      let upstream;

      for (const [index, model] of [MODEL, FALLBACK_MODEL].entries()) {
        upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: requestBody,
          signal: AbortSignal.timeout(25_000),
        });

        if (upstream.status !== 503 || index === 1) break;
        await upstream.body?.cancel();
        await new Promise((resolve) => setTimeout(resolve, 700));
      }

      if (!upstream.ok) {
        console.error(`[viora] Gemini API returned HTTP ${upstream.status}.`);
        const rejectedRequest = [400, 401, 403, 404].includes(upstream.status);
        const temporaryStatus = [429, 503].includes(upstream.status);
        return sendJson(response, temporaryStatus ? upstream.status : 502, {
          error: upstream.status === 429
            ? 'The assistant is busy right now. Please try again shortly.'
            : upstream.status === 503
              ? 'Gemini is temporarily unavailable. Please try again shortly.'
              : rejectedRequest
                ? `Gemini rejected the request (HTTP ${upstream.status}). Check the API key, API access, and model availability.`
                : 'The assistant could not respond right now. Please try again in a moment.',
        });
      }

      const result = await upstream.json();
      const reply = result.candidates?.[0]?.content?.parts
        ?.map((part) => typeof part.text === 'string' ? part.text : '')
        .join('')
        .trim();

      if (!reply) return sendJson(response, 502, { error: 'The assistant returned an empty response. Please try again.' });
      return sendJson(response, 200, { reply });
    } catch (error) {
      console.error('[viora] Gemini request failed:', error.name, error.cause?.code || error.message);
      const status = error.status || (error.name === 'TimeoutError' ? 504 : 500);
      return sendJson(response, status, {
        error: status === 413 ? error.message : 'The assistant could not process that message. Please try again.',
      });
    }
  };
}
