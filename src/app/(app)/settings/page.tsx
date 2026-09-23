"use client";

import { useEffect, useState } from "react";

type ApiKey = {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string;
  createdAt: string;
  lastUsedAt: string | null;
  revoked: boolean;
};

type Plan = {
  id: string;
  actorType: string;
  actorName: string;
  summary: string;
  status: string;
  createdAt: string;
};

type WebhookEvent = {
  id: string;
  source: string;
  eventType: string;
  status: string;
  error: string | null;
  createdAt: string;
};

function useOrigin() {
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads window, only available client-side
    setOrigin(window.location.origin);
  }, []);
  return origin;
}

export default function SettingsPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [justCreated, setJustCreated] = useState<{ key: string; prefix: string } | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const origin = useOrigin();

  async function loadAll() {
    const [k, p, e] = await Promise.all([
      fetch("/api/api-keys").then((r) => r.json()),
      fetch("/api/change-plans").then((r) => r.json()),
      fetch("/api/webhook-events").then((r) => r.json()),
    ]);
    setKeys(k.keys || []);
    setPlans(p.plans || []);
    setEvents(e.events || []);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    loadAll();
  }, []);

  async function createKey() {
    if (!newKeyName.trim()) return;
    const res = await fetch("/api/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newKeyName.trim() }),
    });
    const data = await res.json();
    if (res.ok) {
      setJustCreated({ key: data.key, prefix: data.prefix });
      setNewKeyName("");
      loadAll();
    }
  }

  async function revokeKey(id: string) {
    if (!confirm("Revoke this API key? Anything using it will stop working immediately.")) return;
    await fetch(`/api/api-keys/${id}`, { method: "DELETE" });
    loadAll();
  }

  async function undoPlan(id: string) {
    const res = await fetch(`/api/change-plans/${id}/undo`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) alert(data.error || "Could not undo this plan");
    loadAll();
  }

  return (
    <div className="max-w-3xl space-y-10">
      <div>
        <h1 className="text-xl font-semibold tracking-tight mb-1">Settings</h1>
        <p className="text-sm text-neutral-500">API access, integrations, and the audit trail.</p>
      </div>

      <section>
        <h2 className="text-sm font-semibold mb-1">API keys</h2>
        <p className="text-xs text-neutral-500 mb-3">
          Used by external systems (like your health &amp; safety platform) to call the open API below. Full docs in
          the project README.
        </p>

        {justCreated && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3 text-sm">
            <p className="font-medium text-amber-800 mb-1">Copy this key now — it won&apos;t be shown again:</p>
            <code className="block bg-white border border-amber-200 rounded px-2 py-1.5 text-xs break-all">
              {justCreated.key}
            </code>
          </div>
        )}

        <div className="flex gap-2 mb-3">
          <input
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="Key name, e.g. 'CONQA integration'"
            className="flex-1 rounded-lg border border-border px-3 py-2 text-sm"
          />
          <button onClick={createKey} className="rounded-lg bg-accent text-white px-3.5 py-2 text-sm font-medium hover:bg-indigo-700">
            Generate key
          </button>
        </div>

        <div className="bg-card border border-border rounded-xl divide-y divide-border">
          {keys.map((k) => (
            <div key={k.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <div>
                <p className="font-medium text-neutral-800">{k.name}</p>
                <p className="text-xs text-neutral-400 mono-id">
                  {k.keyPrefix}… · {k.scopes} · created {new Date(k.createdAt).toLocaleDateString()}
                  {k.lastUsedAt && ` · last used ${new Date(k.lastUsedAt).toLocaleDateString()}`}
                </p>
              </div>
              {k.revoked ? (
                <span className="text-xs text-neutral-400">Revoked</span>
              ) : (
                <button onClick={() => revokeKey(k.id)} className="text-xs text-red-600 hover:underline">
                  Revoke
                </button>
              )}
            </div>
          ))}
          {keys.length === 0 && <p className="px-4 py-3 text-sm text-neutral-400">No API keys yet.</p>}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold mb-1">Health &amp; safety system integration</h2>
        <p className="text-xs text-neutral-500 mb-3">
          Two directions: pull/push risks from the outside via the open API, or have the external system push events
          in via a webhook, which land here as a draft risk for review.
        </p>
        <div className="bg-card border border-border rounded-xl p-4 text-sm space-y-3">
          <div>
            <p className="font-medium text-neutral-700 mb-1">Open API (outbound)</p>
            <code className="block bg-neutral-50 border border-border rounded px-2 py-1.5 text-xs">
              GET {origin}/api/v1/risks
            </code>
            <code className="block bg-neutral-50 border border-border rounded px-2 py-1.5 text-xs mt-1">
              POST/PATCH {origin}/api/v1/risks[/:id]
            </code>
            <p className="text-xs text-neutral-500 mt-1">Header: <code>Authorization: Bearer &lt;api key&gt;</code></p>
          </div>
          <div>
            <p className="font-medium text-neutral-700 mb-1">Webhook receiver (inbound)</p>
            <code className="block bg-neutral-50 border border-border rounded px-2 py-1.5 text-xs">
              POST {origin}/api/v1/webhooks/&lt;source&gt;
            </code>
            <p className="text-xs text-neutral-500 mt-1">
              Sources wired up today: <code>generic</code>, <code>conqa</code> (placeholder mapping), <code>safetyculture</code>{" "}
              (placeholder mapping). Edit <code>src/lib/integrations/adapters.ts</code> to match your real system&apos;s
              payload once you have its API docs.
            </p>
          </div>
        </div>

        <h3 className="text-xs font-medium text-neutral-500 mt-4 mb-2">Recent inbound events</h3>
        <div className="bg-card border border-border rounded-xl divide-y divide-border">
          {events.map((e) => (
            <div key={e.id} className="flex items-center justify-between px-4 py-2 text-sm">
              <span>
                {e.source} · {e.eventType}
              </span>
              <span
                className={`text-xs px-1.5 py-0.5 rounded border ${
                  e.status === "mapped"
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : e.status === "error"
                    ? "bg-red-50 text-red-700 border-red-200"
                    : "bg-neutral-100 text-neutral-500 border-neutral-200"
                }`}
              >
                {e.status}
              </span>
            </div>
          ))}
          {events.length === 0 && <p className="px-4 py-3 text-sm text-neutral-400">No inbound events yet.</p>}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold mb-1">Activity &amp; audit trail</h2>
        <p className="text-xs text-neutral-500 mb-3">Every change — manual, AI, import, or API — with one-click undo.</p>
        <div className="bg-card border border-border rounded-xl divide-y divide-border">
          {plans.map((p) => (
            <div key={p.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <div>
                <p className="text-neutral-800">{p.summary}</p>
                <p className="text-xs text-neutral-400">
                  {p.actorName} · {p.actorType} · {new Date(p.createdAt).toLocaleString()}
                </p>
              </div>
              {p.status === "applied" ? (
                <button onClick={() => undoPlan(p.id)} className="text-xs text-accent hover:underline">
                  Undo
                </button>
              ) : (
                <span className="text-xs text-neutral-400">{p.status}</span>
              )}
            </div>
          ))}
          {plans.length === 0 && <p className="px-4 py-3 text-sm text-neutral-400">No activity yet.</p>}
        </div>
      </section>
    </div>
  );
}
