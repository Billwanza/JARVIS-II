import os
from typing import Optional
import psycopg
from psycopg.rows import dict_row
from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from openai import OpenAI
from pydantic import BaseModel, Field

ROOT = os.path.dirname(os.path.abspath(__file__))
DATABASE_URL = os.getenv("DATABASE_URL", "")
PASSWORD = os.getenv("JARVIS_PASSWORD"1234"")
client = OpenAI(api_key=os.environ["OPENAI_API_KEY"]) if os.getenv("OPENAI_API_KEY") else None

app = FastAPI(title="Personal Jarvis")
app.mount("/static", StaticFiles(directory=os.path.join(ROOT, "static")), name="static")

def db():
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is not configured")
    url = DATABASE_URL.replace("postgres://", "postgresql://", 1) if DATABASE_URL.startswith("postgres://") else DATABASE_URL
    return psycopg.connect(url, row_factory=dict_row, sslmode="require")

@app.on_event("startup")
def startup():
    if DATABASE_URL:
        with db() as conn:
            conn.execute("""CREATE TABLE IF NOT EXISTS jarvis_messages (
                id BIGSERIAL PRIMARY KEY, session_id VARCHAR(100) NOT NULL,
                role VARCHAR(20) NOT NULL CHECK (role IN ('user','assistant')),
                content TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())""")
            conn.execute("CREATE INDEX IF NOT EXISTS jarvis_session_idx ON jarvis_messages(session_id, id)")

def auth(value: Optional[str]):
    if not PASSWORD:
        raise HTTPException(503, "Set JARVIS_PASSWORD in Render environment settings.")
    if value != PASSWORD:
        raise HTTPException(401, "Incorrect Jarvis password.")

class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=6000)
    session_id: str = Field(min_length=8, max_length=100)

@app.get("/")
def home():
    return FileResponse(os.path.join(ROOT, "static", "index.html"))

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/status")
def status(x_jarvis_password: Optional[str] = Header(default=None)):
    auth(x_jarvis_password)
    return {"status": "online", "memory": bool(DATABASE_URL), "ai_ready": bool(client)}

@app.post("/chat")
def chat(req: ChatRequest, x_jarvis_password: Optional[str] = Header(default=None)):
    auth(x_jarvis_password)
    if client is None:
        raise HTTPException(503, "Set OPENAI_API_KEY in Render environment settings.")
    if not DATABASE_URL:
        raise HTTPException(503, "Configure a Render PostgreSQL database and DATABASE_URL.")
    try:
        with db() as conn:
            history = conn.execute(
                "SELECT role, content FROM jarvis_messages WHERE session_id=%s ORDER BY id DESC LIMIT 20",
                (req.session_id,)).fetchall()
            history = list(reversed(history))
            conn.execute("INSERT INTO jarvis_messages(session_id,role,content) VALUES(%s,%s,%s)",
                         (req.session_id, "user", req.message))
        messages = [{"role":"system","content":
            "You are Jarvis, a helpful, concise personal assistant. Be practical. "
            "Do not claim to access calendars, devices, files, or services unless connected."}]
        messages[0]["content"] += memories_text()
        messages.extend({"role": x["role"], "content": x["content"]} for x in history)
        messages.append({"role":"user","content":req.message})
        result = client.chat.completions.create(
            model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"), messages=messages)
        reply = result.choices[0].message.content or "I couldn't generate a reply."
        with db() as conn:
            conn.execute("INSERT INTO jarvis_messages(session_id,role,content) VALUES(%s,%s,%s)",
                         (req.session_id, "assistant", reply))
        return {"reply": reply}
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Jarvis request failed: {type(exc).__name__}: {exc}")
        raise HTTPException(500, "Jarvis had a server error. Check the Render logs.")

@app.post("/clear")
def clear(req: ChatRequest, x_jarvis_password: Optional[str] = Header(default=None)):
    auth(x_jarvis_password)
    if not DATABASE_URL:
        raise HTTPException(503, "Database is not configured.")
    with db() as conn:
        conn.execute("DELETE FROM jarvis_messages WHERE session_id=%s", (req.session_id,))
    return {"status":"cleared"}

class MemoryIn(BaseModel):
    text: str = Field(min_length=1, max_length=1000)

@app.on_event("startup")
def memory_startup():
    if DATABASE_URL:
        with db() as conn:
            conn.execute("""CREATE TABLE IF NOT EXISTS jarvis_memories (
                id BIGSERIAL PRIMARY KEY, content TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())""")

def memories_text() -> str:
    """Saved memories, formatted to append to Jarvis's system prompt."""
    if not DATABASE_URL:
        return ""
    try:
        with db() as conn:
            rows = conn.execute("SELECT content FROM jarvis_memories ORDER BY id").fetchall()
    except Exception:
        return ""
    if not rows:
        return ""
    return "\n\nThings the user has asked you to remember:\n" + "\n".join("- " + r["content"] for r in rows)

@app.get("/memories")
def list_memories(x_jarvis_password: Optional[str] = Header(default=None)):
    auth(x_jarvis_password)
    if not DATABASE_URL:
        raise HTTPException(503, "Database is not configured.")
    with db() as conn:
        rows = conn.execute("SELECT id, content FROM jarvis_memories ORDER BY id DESC").fetchall()
    return {"memories": [{"id": r["id"], "text": r["content"]} for r in rows]}

@app.post("/memories")
def add_memory(req: MemoryIn, x_jarvis_password: Optional[str] = Header(default=None)):
    auth(x_jarvis_password)
    if not DATABASE_URL:
        raise HTTPException(503, "Database is not configured.")
    text = req.text.strip()
    with db() as conn:
        row = conn.execute("INSERT INTO jarvis_memories(content) VALUES(%s) RETURNING id", (text,)).fetchone()
    return {"id": row["id"], "text": text}

@app.delete("/memories/{memory_id}")
def delete_memory(memory_id: int, x_jarvis_password: Optional[str] = Header(default=None)):
    auth(x_jarvis_password)
    if not DATABASE_URL:
        raise HTTPException(503, "Database is not configured.")
    with db() as conn:
        conn.execute("DELETE FROM jarvis_memories WHERE id=%s", (memory_id,))
    return {"status": "deleted"}
