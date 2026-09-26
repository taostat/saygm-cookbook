// region: client
/**
 * Sends the conversation to the chat route and calls onText as each piece of the reply arrives.
 *
 * @param {string} url
 * @param {Array<{ role: "user" | "assistant", content: string }>} messages
 * @param {(text: string) => void} onText
 * @returns {Promise<string>} the full reply
 */
export async function streamChat(url, messages, onText) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages }),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Chat request failed with status ${response.status}`);
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let reply = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return reply;
    }
    reply += value;
    onText(value);
  }
}
// endregion
