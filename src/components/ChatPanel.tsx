"use client";

import { useEffect, useRef, useState } from "react";

type PlanRef = { planId: string; summary: string; opsCount: number; status: "proposed" | "applied" | "discarded" };
type ChatMsg = { role: "user" | "assistant"; content: string; plans?: PlanRef[] };

export default function ChatPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMsg[]>([
    {
      role: "assistant",
      content:
        "Hi, I'm Risk AI. Ask me to find, summarise, or change risks — for example \"add a slippery floors risk at Brookvale\" or \"what's overdue for review this month?\". I'll always show you the change before it's saved.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setError(null);
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { role: "user", content: text }]);
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Chat request failed");
      const plans: PlanRef[] = (data.proposedPlans || []).map((p: { planId: string; summary: string; opsCount: number }) => ({
        ...p,
        status: "proposed",
      }));
      setMessages((m) => [...m, { role: "assistant", content: data.reply, plans: plans.length ? plans : undefined }]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function actOnPlan(planId: string, action: "apply" | "discard") {
    setMessages((m) =>
      m.map((msg) =>
        msg.plans
          ? {
              ...msg,
              plans: msg.plans.map((p) => (p.planId === planId ? { ...p, status: "…" as PlanRef["status"] } : p)),
            }
          : msg
      )
    );
    try {
      const res = await fetch(`/api/change-plans/${planId}/${action}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed to ${action} plan`);
      setMessages((m) =>
        m.map((msg) =>
          msg.plans
            ? {
                ...msg,
                plans: msg.plans.map((p) =>
                  p.planId === planId ? { ...p, status: action === "apply" ? "applied" : "discarded" } : p
                ),
              }
            : msg
        )
      );
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-30 flex justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative w-full max-w-md h-full bg-card border-l border-border flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-4 h-14 border-b border-border">
          <div className="flex items-center gap-2">
            <span className="text-accent">✦</span>
            <span className="font-medium text-sm">Ask Risk AI</span>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700 text-lg leading-none">
            ×
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
              <div
                className={
                  m.role === "user"
                    ? "max-w-[85%] rounded-2xl rounded-br-sm bg-accent text-white text-sm px-3.5 py-2"
                    : "max-w-[95%] text-sm"
                }
              >
                <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
                {m.plans?.map((p) => (
                  <div key={p.planId} className="mt-2 rounded-xl border border-border bg-neutral-50 p-3 text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-neutral-700">Change plan</span>
                      <span className="rounded-full bg-accent-soft text-accent px-2 py-0.5 font-medium">
                        {p.opsCount} change{p.opsCount === 1 ? "" : "s"}
                      </span>
                    </div>
                    <p className="text-neutral-600 mb-2">{p.summary}</p>
                    {p.status === "proposed" && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => actOnPlan(p.planId, "apply")}
                          className="rounded-md bg-accent text-white px-2.5 py-1 font-medium hover:bg-indigo-700"
                        >
                          Apply
                        </button>
                        <button
                          onClick={() => actOnPlan(p.planId, "discard")}
                          className="rounded-md border border-border px-2.5 py-1 text-neutral-600 hover:bg-neutral-100"
                        >
                          Discard
                        </button>
                      </div>
                    )}
                    {p.status === "applied" && (
                      <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                        ✓ Applied
                      </span>
                    )}
                    {p.status === "discarded" && <span className="text-neutral-400 font-medium">Discarded</span>}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {loading && <p className="text-xs text-neutral-400">Thinking…</p>}
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        <div className="border-t border-border p-3">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={2}
              placeholder="Ask a question or request a change…"
              className="flex-1 resize-none rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
            <button
              onClick={send}
              disabled={loading || !input.trim()}
              className="rounded-lg bg-accent text-white text-sm px-3 py-2 h-fit hover:bg-indigo-700 disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
