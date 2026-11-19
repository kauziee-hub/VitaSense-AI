import { fetch as streamingFetch } from 'expo/fetch';

import { forgetServer, serverUrl } from './server';

/**
 * Sends a chat message and streams the reply.
 * The backend speaks SSE: `data: <text>` lines, events separated by a blank line,
 * and a final `data: [DONE]`.
 */
export async function streamChat(
  {
    userId,
    sessionId,
    message,
    signal,
  }: { userId: number; sessionId: string; message: string; signal?: AbortSignal },
  onText: (accumulated: string) => void,
): Promise<string> {
  const base = await serverUrl();
  let response: Awaited<ReturnType<typeof streamingFetch>>;
  try {
    response = await streamingFetch(`${base}/api/v1/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ user_id: userId, session_id: sessionId, message }),
      signal,
    });
  } catch (error) {
    if (!signal?.aborted) forgetServer();
    throw error;
  }

  if (response.status === 503) throw new Error('The AI assistant is not configured on the server.');
  if (!response.ok || !response.body) throw new Error('VitaSense could not answer right now.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';

  const flushEvents = () => {
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = rawEvent
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, ''))
        .join('\n');
      if (data === '[DONE]') return true;
      if (data) {
        text += data;
        onText(text);
      }
      boundary = buffer.indexOf('\n\n');
    }
    return false;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    if (flushEvents()) break;
  }
  buffer += decoder.decode();
  flushEvents();
  return text;
}

export function newSessionId(): string {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
