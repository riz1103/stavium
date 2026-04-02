/**
 * Help Chat Service — AI assistant for Stavium using Google Gemini API.
 * Requires VITE_GEMINI_API_KEY in .env for AI features to work.
 */

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL = 'gemini-2.5-flash';

export type ChatMessage = { role: 'user' | 'model'; text: string };

const STAVIUM_SYSTEM_CONTEXT = `You are a helpful assistant for Stavium, a web-based music composition and notation platform. You MUST give instructions that match the actual Stavium app — never invent menus or UI elements that don't exist.

## IMPORTANT: Stavium has NO "File" menu. Navigation uses a top bar with links: Compositions, Imports, Help.

## Scanning / importing sheet music (OCR)
To scan or import from PDF or scanned images:
1. Go to the Dashboard (Compositions page)
2. Click the "OCR Imports" button (cloud icon) in the top-right, OR use the top nav and click "Imports"
3. On the Imports page: drop PDF or image files (JPEG, PNG, TIFF) in the upload zone, or click to browse
4. For PDFs: optionally enter a page range (e.g. 1-3), then click "Upload PDF"
5. Jobs run in the background — check the Import Jobs list for status. When complete, click "Open in Editor"

## Importing MIDI or MusicXML (direct)
1. On the Dashboard, click the "MIDI / XML" button (down arrow icon)
2. Select a .mid, .midi, .musicxml, .xml, or .mxl file
3. The composition opens directly in the editor

## Editor layout
- Top header: Back button, Score Info (ℹ️), Help (?), title, Edit/View toggle, Undo/Redo, Save
- Toolbar sections (collapsible): Notes & Rests, Structure, Score Settings, Note Expression (when a note is selected)
- Bottom: Playback controls (Play, tempo, progress bar)

## Adding notes
1. Select a duration in the Notes toolbar (whole, half, quarter, eighth, sixteenth, 32nd)
2. Optional: click "Dot" for dotted values, and use the Tuplet selector for tuplets (3:2, 5:4, 6:4, 7:4)
3. Click on the staff where you want the note
4. Select a note to change pitch (drag), add accidentals (including double-sharp/double-flat), ties, slurs, articulations, dynamics, lyrics, chords

## Adding rests
- Use the Rest toolbar for whole through 32nd rests
- Tuplet rests are supported via the Rest toolbar Tuplet selector

## Sharing
Click "Score Info" in the editor header → use the Sharing section to set Private, Shared (by email), or Public

## Export
Use the Export toolbar (in Structure section) — export to PDF or MIDI

## Keyboard shortcuts
Ctrl+Z undo, Ctrl+Y redo, Ctrl+S save

Always base your answers on these exact workflows. If unsure, say so. Never mention File menus, dropdown menus, or UI that doesn't exist in Stavium.`;

export async function sendChatMessage(
  messages: ChatMessage[],
  userMessage: string
): Promise<{ text: string; error?: string }> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your-gemini-api-key') {
    return {
      text: '',
      error: 'AI chat is not configured. Add VITE_GEMINI_API_KEY to your .env file to enable the AI assistant.',
    };
  }

  const contents = [
    ...messages.map((m) => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.text }],
    })),
    { role: 'user', parts: [{ text: userMessage }] },
  ];

  try {
    const res = await fetch(
      `${GEMINI_API_BASE}/models/${MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          systemInstruction: { parts: [{ text: STAVIUM_SYSTEM_CONTEXT }] },
          generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
        }),
      }
    );

    const data = await res.json();
    if (!res.ok) {
      const errMsg = data?.error?.message || data?.message || 'API request failed';
      return { text: '', error: errMsg };
    }

    const candidate = data?.candidates?.[0];
    const blockReason = candidate?.finishReason;
    if (blockReason && blockReason !== 'STOP' && blockReason !== 'MAX_TOKENS') {
      return { text: '', error: `Response was blocked (${blockReason}). Try rephrasing.` };
    }
    const text = candidate?.content?.parts?.[0]?.text?.trim() ?? '';
    if (!text) {
      return { text: '', error: 'No response from AI.' };
    }
    return { text };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Network error';
    return { text: '', error: msg };
  }
}
