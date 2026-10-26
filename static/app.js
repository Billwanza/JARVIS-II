(() => {
  const C = window.JARVIS_CONFIG;
  const $ = (id) => document.getElementById(id);
  const log = $("log"), input = $("chatInput"), orb = $("orb"), caption = $("caption");
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }
  };
  let sid = store.get("jarvis_sid");
  if (!sid) { sid = (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(16).slice(2)); store.set("jarvis_sid", sid); }
  let pw = store.get("jarvis_pw") || "";
  let state = "idle", listening = false, rec = null;

  /* ---------- state ---------- */
  const LABELS = { idle: "Standby", listening: "Listening", thinking: "Thinking", speaking: "Speaking", offline: "Offline" };
  function setState(s) { state = s; orb.dataset.state = s; $("statusPill").dataset.state = s; $("statusText").textContent = LABELS[s]; }
  const say = (t) => (caption.textContent = t);
  function setNotice(t) { $("notice").hidden = !t; $("notice").textContent = t || ""; }

  /* ---------- lock screen ---------- */
  function showLock(msg) { $("lockMsg").textContent = msg; $("lock").hidden = false; $("lockInput").value = ""; $("lockInput").focus(); }
  $("lockForm").addEventListener("submit", (e) => {
    e.preventDefault();
    pw = $("lockInput").value; store.set("jarvis_pw", pw);
    $("lock").hidden = true; init();
  });

  /* ---------- API ---------- */
  async function api(spec, { id, body } = {}) {
    if (!spec || !spec.path) throw new Error("not-configured");
    let path = spec.path;
    if (id != null) path = path.includes("{id}") ? path.replace("{id}", encodeURIComponent(id)) : path.replace(/\/$/, "") + "/" + encodeURIComponent(id);
    const headers = { "Content-Type": "application/json", ...(pw ? { [C.auth.header]: pw } : {}), ...C.headers };
    const res = await fetch(C.apiBase.replace(/\/$/, "") + path, {
      method: spec.method || "GET", headers, body: body !== undefined ? JSON.stringify(body) : undefined
    });
    if (res.status === 401) { showLock("Incorrect password. Try again."); throw new Error("HTTP 401"); }
    if (!res.ok) {
      let detail = ""; try { detail = (await res.json()).detail || ""; } catch {}
      const err = new Error("HTTP " + res.status); err.detail = detail; throw err;
    }
    const text = await res.text();
    try { return JSON.parse(text); } catch { return text; }
  }

  /* ---------- chat ---------- */
  function addMsg(who, text, cls = "") {
    const d = document.createElement("div");
    d.className = "msg " + cls;
    const s = document.createElement("small"); s.textContent = who;
    d.append(s, document.createTextNode(text));
    log.append(d); log.scrollTop = log.scrollHeight;
    return d;
  }
  const greet = () => addMsg("Jarvis", "Online. Ask me something, or press Talk.");
  greet();

  async function send(text) {
    text = text.trim();
    if (!text) return;
    stopSpeaking();
    addMsg("You", text, "me");
    input.value = "";
    const wait = addMsg("Jarvis", "Working on it…", "wait");
    setState("thinking"); say("Working on it…");
    try {
      const data = await api(C.chat, { body: C.chat.body(text, [], sid) });
      const reply = String(C.chat.reply(data) || "").trim() || "(Empty reply from the backend.)";
      wait.remove(); addMsg("Jarvis", reply);
      setState("idle"); say("Ready when you are.");
      if ($("speakToggle").checked) speak(reply);
    } catch (e) {
      wait.remove();
      if (e.message === "HTTP 401") { setState("idle"); say("Locked."); return; }
      const msg = e.detail ? e.detail
        : "Couldn’t reach the backend (" + e.message + "). If Render is waking up, try again in a minute.";
      addMsg("System", msg, "err");
      setState(e.detail ? "idle" : "offline"); say(e.detail ? "Ready when you are." : "No connection.");
    }
  }
  $("chatForm").addEventListener("submit", (e) => { e.preventDefault(); send(input.value); });

  $("clearBtn").addEventListener("click", async () => {
    if (!confirm("Clear this conversation, including what Jarvis remembers of it?")) return;
    try { await api(C.clear, { body: C.clear.body(sid) }); log.innerHTML = ""; greet(); }
    catch (e) { if (e.message !== "HTTP 401") addMsg("System", e.detail || "Couldn’t clear the conversation (" + e.message + ").", "err"); }
  });

  /* ---------- voice out ---------- */
  const synth = window.speechSynthesis;
  function pickVoice() {
    const v = synth.getVoices();
    return v.find((x) => x.lang === C.voiceLang) || v.find((x) => x.lang.startsWith(C.voiceLang.split("-")[0])) || null;
  }
  function speak(text) {
    if (!synth) return;
    const u = new SpeechSynthesisUtterance(text.replace(/[*_`#>~]/g, "").slice(0, 1500));
    const v = pickVoice(); if (v) u.voice = v;
    u.onstart = () => { setState("speaking"); say("Speaking…"); };
    u.onend = u.onerror = () => { if (state === "speaking") { setState("idle"); say("Ready when you are."); } };
    synth.speak(u);
  }
  function stopSpeaking() { if (synth) synth.cancel(); if (state === "speaking") { setState("idle"); say("Ready when you are."); } }
  $("stopBtn").addEventListener("click", stopSpeaking);
  if (!synth) $("speakToggle").disabled = true;

  /* ---------- voice in ---------- */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = $("micBtn");
  if (!SR) {
    mic.disabled = true; $("voiceHint").hidden = false;
    $("voiceHint").textContent = "Voice input isn’t supported in this browser. Use Chrome, Edge or Safari. Typing still works.";
  } else {
    rec = new SR();
    rec.lang = C.speechLang || navigator.language || "en-AU";
    rec.interimResults = true; rec.continuous = false;
    let finalText = "";
    rec.onstart = () => { listening = true; finalText = ""; mic.setAttribute("aria-pressed", "true"); mic.textContent = "Listening…"; setState("listening"); say("Go ahead, I’m listening."); };
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t; else interim += t;
      }
      input.value = finalText + interim;
    };
    rec.onerror = (e) => {
      const m = { "not-allowed": "Microphone blocked. Allow mic access for this site in your browser.", "no-speech": "I didn’t catch anything. Press Talk to try again.", "audio-capture": "No microphone found." };
      say(m[e.error] || "Voice input error: " + e.error);
    };
    rec.onend = () => {
      listening = false; mic.setAttribute("aria-pressed", "false"); mic.textContent = "Talk";
      if (state === "listening") setState("idle");
      if (finalText.trim()) send(finalText);
    };
    mic.addEventListener("click", () => { if (listening) { rec.stop(); return; } stopSpeaking(); try { rec.start(); } catch {} });
  }

  /* ---------- memories ---------- */
  const list = $("memList");
  function note(text) {
    list.innerHTML = "";
    const li = document.createElement("li"); li.className = "empty";
    const s = document.createElement("span"); s.className = "empty"; s.textContent = text;
    li.append(s); list.append(li);
  }
  const memError = (e, what) => e.message === "HTTP 404"
    ? "Memory routes aren’t on your backend yet. Add optional-memory-patch/backend_memory_patch.py (see README)."
    : "Couldn’t " + what + " (" + (e.detail || e.message) + ").";
  async function loadMemories() {
    try {
      const items = C.memories.list.parse(await api(C.memories.list)).map(C.memories.normalize);
      if (!items.length) return note("Nothing saved yet. Add a memory below.");
      list.innerHTML = "";
      items.forEach((m) => {
        const li = document.createElement("li");
        const s = document.createElement("span"); s.textContent = m.text;
        const b = document.createElement("button"); b.type = "button"; b.textContent = "Delete"; b.setAttribute("aria-label", "Delete memory: " + m.text);
        b.addEventListener("click", () => removeMemory(m.id, b));
        li.append(s, b); list.append(li);
      });
    } catch (e) { if (e.message !== "HTTP 401") note(memError(e, "load memories")); }
  }
  async function removeMemory(id, btn) {
    btn.disabled = true;
    try { await api(C.memories.remove, { id }); await loadMemories(); }
    catch (e) { btn.disabled = false; if (e.message !== "HTTP 401") addMsg("System", memError(e, "delete that memory"), "err"); }
  }
  $("memForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const t = $("memInput").value.trim(); if (!t) return;
    try { await api(C.memories.add, { body: C.memories.add.body(t) }); $("memInput").value = ""; await loadMemories(); }
    catch (err) { if (err.message !== "HTTP 401") addMsg("System", memError(err, "save that memory"), "err"); }
  });

  /* ---------- start ---------- */
  async function init() {
    try {
      const s = await api(C.status);
      const problems = [];
      if (s.ai_ready === false) problems.push("OPENAI_API_KEY isn’t set on Render");
      if (s.memory === false) problems.push("DATABASE_URL isn’t set on Render");
      setNotice(problems.length ? "Backend setup needed: " + problems.join("; ") + "." : "");
      setState("idle");
      loadMemories();
    } catch (e) {
      if (e.message === "HTTP 401") return;
      setState("offline"); say("No connection.");
      setNotice("Couldn’t reach the backend (" + (e.detail || e.message) + "). If it’s waking up on Render’s free plan, reload in a minute.");
    }
  }
  if (!pw) showLock("Enter your Jarvis password."); else init();

  const tick = () => ($("clock").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
  tick(); setInterval(tick, 20000);
})();
