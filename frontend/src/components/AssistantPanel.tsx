import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';

interface Msg {
  role: 'user' | 'assistant';
  text: string;
  offTopic?: boolean;
}

const SUGGESTIONS = [
  'Which machines are in a warning or critical state right now?',
  'What is the current power deviation on the worst-performing machine?',
  'What are the open incidents and their top hypotheses?',
];

export function AssistantPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', text: q }]);
    setBusy(true);
    try {
      const res = await api.askAssistant(q);
      setMessages((m) => [...m, { role: 'assistant', text: res.answer, offTopic: res.offTopic }]);
    } catch (e: any) {
      setMessages((m) => [...m, { role: 'assistant', text: `Sorry, something went wrong: ${e.message}` }]);
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className="assistant-overlay" onClick={onClose}>
      <div className="assistant-panel" onClick={(e) => e.stopPropagation()}>
        <header>
          <b>Assistant</b>
          <small>Answers questions about this app only</small>
          <button className="close" onClick={onClose} aria-label="Close assistant">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="assistant-msgs" ref={scrollRef}>
          {messages.length === 0 && (
            <div className="assistant-empty">
              <p>Ask me about the machines, alerts, and incidents on this dashboard.</p>
              <div className="sugg">
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => send(s)} disabled={busy}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              <span className="who">{m.role === 'user' ? 'You' : 'Assistant'}</span>
              <p>{m.text}</p>
              {m.offTopic && <small className="offtopic">I can only help with questions about the AshvaTrace app.</small>}
            </div>
          ))}
          {busy && (
            <div className="msg assistant">
              <span className="who">Assistant</span>
              <p className="typing">Thinking…</p>
            </div>
          )}
        </div>

        <form
          className="assistant-input"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about a machine, alert, or incident…"
            maxLength={500}
            autoFocus
          />
          <button type="submit" disabled={busy || !input.trim()} aria-label="Send">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14" />
              <path d="M12 5l7 7-7 7" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}
