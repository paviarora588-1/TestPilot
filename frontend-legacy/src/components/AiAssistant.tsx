import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProductContext } from '../context/ProductContext';
import { chatWithAssistant, errorMessage } from '../services/api';

type ChatMessage =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; result?: AssistantResult }
  | { role: 'error'; text: string };

interface AssistantResult {
  needs_clarification?: boolean;
  test_case?: { id: number; external_id: string; title: string };
  mappings?: { status: string }[];
  script?: { id: number; file_name: string; review_status: string } | null;
  blocked?: boolean;
}

type HistoryTurn = { role: 'user' | 'assistant'; content: string };

const EXAMPLES = [
  'Create a function Ztest1',
  'Create a test case for creating a vendor master record',
  'Create a test case to update a customer address',
];

export function AiAssistant() {
  const { selectedProductId, selectedProduct } = useProductContext();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<HistoryTurn[]>([]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open, sending]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    if (!selectedProductId) {
      setMessages((prev) => [...prev, { role: 'user', text: trimmed }, { role: 'error', text: 'Select a product first (top-left selector) so the assistant knows which guide to use.' }]);
      setInput('');
      return;
    }
    setMessages((prev) => [...prev, { role: 'user', text: trimmed }]);
    setInput('');
    setSending(true);
    try {
      const data = await chatWithAssistant(selectedProductId, trimmed, historyRef.current);
      setMessages((prev) => [...prev, { role: 'assistant', text: data.reply || 'Done.', result: data }]);
      historyRef.current = [...historyRef.current, { role: 'user', content: trimmed }, { role: 'assistant', content: data.reply || '' }];
      if (!data.needs_clarification) {
        // Conversation resolved (test case created or a hard error) — start fresh next message.
        historyRef.current = [];
      }
    } catch (error) {
      setMessages((prev) => [...prev, { role: 'error', text: errorMessage(error) }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      {/* Floating launcher */}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="AI Assistant"
        style={{
          position: 'fixed', right: '1.5rem', bottom: '1.5rem', zIndex: 80,
          width: 54, height: 54, borderRadius: '50%',
          display: 'grid', placeItems: 'center',
          background: 'linear-gradient(135deg, #2997FF, #6E5BFF)',
          boxShadow: open ? '0 4px 24px rgba(41,151,255,0.55)' : '0 6px 28px rgba(41,151,255,0.45)',
          border: 'none', color: '#fff', cursor: 'pointer',
          transform: open ? 'scale(0.94)' : 'scale(1)',
          transition: 'transform .18s ease, box-shadow .18s ease',
        }}
      >
        {open ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.8 4.6L18 9.5l-4.2 1.9L12 16l-1.8-4.6L6 9.5l4.2-1.9L12 3z"/><path d="M19 14l.9 2.3L22 17l-2.1.7L19 20l-.9-2.3L16 17l2.1-.7L19 14z"/></svg>
        )}
      </button>

      {/* Chat panel */}
      {open && (
        <div
          className="card"
          style={{
            position: 'fixed', right: '1.5rem', bottom: '5.5rem', zIndex: 80,
            width: 380, maxWidth: 'calc(100vw - 2rem)', maxHeight: '70vh',
            display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden',
          }}
        >
          <div style={{ padding: '1rem 1.1rem', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <strong style={{ fontSize: '.9rem', fontWeight: 700 }}>AI Assistant</strong>
            <p style={{ margin: '.2rem 0 0', fontSize: '.72rem', color: 'rgba(255,255,255,0.45)' }}>
              {selectedProduct ? `Grounded in ${selectedProduct.name}'s guide` : 'Select a product to begin'}
            </p>
          </div>

          <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.1rem', display: 'flex', flexDirection: 'column', gap: '.65rem' }}>
            {messages.length === 0 && (
              <div style={{ fontSize: '.78rem', color: 'rgba(255,255,255,0.5)', lineHeight: 1.6 }}>
                <p style={{ marginBottom: '.5rem' }}>
                  Tell me what to test, e.g. <em>"Create a function Ztest1"</em>. I'll write the manual steps from your
                  product guide, map them to library objects, and generate the script.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
                  {EXAMPLES.map((example) => (
                    <button
                      key={example}
                      type="button"
                      onClick={() => send(example)}
                      style={{
                        textAlign: 'left', fontSize: '.72rem', padding: '.5rem .65rem', borderRadius: 10,
                        background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                        color: 'rgba(255,255,255,0.75)', cursor: 'pointer',
                      }}
                    >
                      {example}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((message, index) => (
              <div
                key={index}
                style={{
                  alignSelf: message.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '92%',
                  borderRadius: 12,
                  padding: '.55rem .75rem',
                  fontSize: '.78rem', lineHeight: 1.55,
                  background:
                    message.role === 'user' ? 'rgba(41,151,255,0.18)' :
                    message.role === 'error' ? 'rgba(255,69,58,0.12)' : 'rgba(255,255,255,0.06)',
                  border: `1px solid ${message.role === 'user' ? 'rgba(41,151,255,0.3)' : message.role === 'error' ? 'rgba(255,69,58,0.25)' : 'rgba(255,255,255,0.1)'}`,
                  color: message.role === 'error' ? '#FF8A80' : '#fff',
                }}
              >
                <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{message.text}</p>

                {message.role === 'assistant' && message.result?.test_case && (
                  <div style={{ marginTop: '.55rem', paddingTop: '.55rem', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                    <p style={{ margin: 0, fontWeight: 700, fontSize: '.74rem' }}>
                      {message.result.test_case.external_id} — {message.result.test_case.title}
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem', marginTop: '.5rem' }}>
                      <button type="button" className="btn" style={{ minHeight: 28, padding: '.35rem .65rem', fontSize: '.68rem' }} onClick={() => navigate('/test-cases')}>Open Test Case</button>
                      {message.result.mappings && message.result.mappings.length > 0 && (
                        <button type="button" className="btn" style={{ minHeight: 28, padding: '.35rem .65rem', fontSize: '.68rem' }} onClick={() => navigate('/mapping')}>Review Mapping</button>
                      )}
                      {message.result.script && (
                        <button type="button" className="btn btn-primary" style={{ minHeight: 28, padding: '.35rem .65rem', fontSize: '.68rem' }} onClick={() => navigate('/scripts')}>Open Script</button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {sending && (
              <div style={{ alignSelf: 'flex-start', fontSize: '.74rem', color: 'rgba(255,255,255,0.45)' }}>
                Thinking…
              </div>
            )}
          </div>

          <form
            onSubmit={(event) => { event.preventDefault(); void send(input); }}
            style={{ display: 'flex', gap: '.5rem', padding: '.85rem 1.1rem', borderTop: '1px solid rgba(255,255,255,0.08)' }}
          >
            <input
              className="input"
              placeholder="Create a function Ztest1…"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              disabled={sending}
              style={{ fontSize: '.78rem' }}
            />
            <button type="submit" className="btn btn-primary" disabled={sending || !input.trim()} style={{ minHeight: 38, padding: '0 .9rem' }}>
              Send
            </button>
          </form>
        </div>
      )}
    </>
  );
}
