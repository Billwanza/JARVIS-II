/* ------------------------------------------------------------------
   JARVIS FRONTEND CONFIG — set up for your FastAPI backend (main.py).
   Because main.py serves this page itself, apiBase is "" (same origin),
   so no CORS setup is needed.
------------------------------------------------------------------- */
window.JARVIS_CONFIG = {
  apiBase: "",

  // Your backend reads the password from this header (JARVIS_PASSWORD on Render).
  // The page asks for the password once and remembers it in this browser.
  auth: { header: "X-Jarvis-Password" },
  headers: {},

  // GET /status — used to show whether the AI key and database are set up.
  status: { path: "/status", method: "GET" },

  // POST /chat — needs message + session_id, returns { reply }.
  chat: {
    path: "/chat",
    method: "POST",
    body: (message, history, sessionId) => ({ message, session_id: sessionId }),
    reply: (data) => typeof data === "string" ? data : (data.reply ?? "")
  },

  // POST /clear — wipes this browser's saved conversation on the server.
  clear: {
    path: "/clear",
    method: "POST",
    body: (sessionId) => ({ message: "clear", session_id: sessionId })
  },

  // Memories. main.py has no memory routes yet: add optional-memory-patch/backend_memory_patch.py
  memories: {
    list:   { path: "/memories",      method: "GET",
              parse: (d) => Array.isArray(d) ? d : (d.memories ?? []) },
    add:    { path: "/memories",      method: "POST", body: (text) => ({ text }) },
    remove: { path: "/memories/{id}", method: "DELETE" },
    normalize: (m) => typeof m === "string"
      ? { id: m, text: m }
      : { id: m.id, text: m.text ?? m.content ?? "" }
  },

  speechLang: "",      // "" = your browser's language
  voiceLang: "en-GB"   // preferred voice for spoken replies
};
