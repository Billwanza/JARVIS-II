import os
from fastapi import FastAPI
from pydantic import BaseModel
from openai import OpenAI

app = FastAPI()
client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])

class ChatRequest(BaseModel):
    message: str

@app.get("/")
def home():
    return {"status": "Jarvis is online"}

@app.post("/chat")
def chat(req: ChatRequest):
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "You are Jarvis, Billy's concise personal assistant."},
            {"role": "user", "content": req.message}
        ]
    )
    return {"reply": response.choices[0].message.content}
