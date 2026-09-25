"use client";

import { useEffect, useState } from "react";
import { ROLE_LABELS, USER_ROLES } from "@/lib/roles";

// Settings sections added for the TA builder: the Make.com / M-Files / H&S
// manager handoff config, user accounts (so PMs and the H&S manager can log
// in), and changing your own password.

type Me = { id: string; name: string; email: string; role: string };
type WorkflowSettings = { makeWebhookUrl: string; mfilesEmail: string; hsManagerEmail: string; hsManagerName: string };
type UserRow = { id: string; name: string; email: string; role: string; createdAt: string };

const inputCls = "w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:bg-neutral-50 disabled:text-neutral-500";

export default function TaSettings() {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setMe(d.user));
  }, []);
  if (!me) return null;
  const isAdmin = me.role === "admin";
  return (
    <>
      <WorkflowSection isAdmin={isAdmin} />
      {isAdmin && <UsersSection me={me} />}
      <PasswordSection />
    </>
  );
}

function WorkflowSection({ isAdmin }: { isAdmin: boolean }) {
  const [s, setS] = useState<WorkflowSettings | null>(null);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);

  useEffect(() => {
    fetch("/api/settings/ta-workflow")
      .then((r) => r.json())
      .then((d) => {
        setS(d.settings);
        setAiConfigured(!!d.aiConfigured);
      });
  }, []);

  async function save() {
    if (!s) return;
    setBusy("save");
    setMsg(null);
    const res = await fetch("/api/settings/ta-workflow", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
    const d = await res.json();
    setBusy(null);
    if (!res.ok) return setMsg({ ok: false, text: d.error || "Couldn't save" });
    setS(d.settings);
    setMsg({ ok: true, text: "Saved." });
  }

  async function test() {
    setBusy("test");
    setMsg(null);
    const res = await fetch("/api/settings/ta-workflow/test", { method: "POST" });
    const d = await res.json();
    setBusy(null);
    if (!res.ok) return setMsg({ ok: false, text: d.error || "Test failed" });
    setMsg({ ok: d.delivery.status === "sent", text: d.delivery.message });
  }

  if (!s) return null;
  const set = (k: keyof WorkflowSettings) => (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [k]: e.target.value });

  return (
    <section>
      <h2 className="text-sm font-semibold mb-1">TA workflow (Make.com → M-Files &amp; H&amp;S review)</h2>
      <p className="text-xs text-neutral-500 mb-3">
        When a TA is submitted, approved, or sent back for changes, the app posts it (with the Word document attached) to your
        Make.com webhook. The Make scenario files it to M-Files and emails the H&amp;S manager. Payload spec is in the README
        (“TA builder → Make.com payload”).
      </p>
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <label className="block">
          <span className="block text-xs font-medium text-neutral-500 mb-1">Make.com custom webhook URL</span>
          <input disabled={!isAdmin} value={s.makeWebhookUrl} onChange={set("makeWebhookUrl")} placeholder="https://hook.eu2.make.com/…" className={inputCls} />
        </label>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs font-medium text-neutral-500 mb-1">M-Files inbox email</span>
            <input disabled={!isAdmin} value={s.mfilesEmail} onChange={set("mfilesEmail")} placeholder="ta@sansom.m-files…" className={inputCls} />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-neutral-500 mb-1">H&amp;S manager email</span>
            <input disabled={!isAdmin} value={s.hsManagerEmail} onChange={set("hsManagerEmail")} placeholder="hs.manager@sansom.co.nz" className={inputCls} />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-neutral-500 mb-1">H&amp;S manager name</span>
            <input disabled={!isAdmin} value={s.hsManagerName} onChange={set("hsManagerName")} className={inputCls} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {isAdmin && (
            <>
              <button onClick={save} disabled={!!busy} className="rounded-lg bg-accent text-white px-3.5 py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
                {busy === "save" ? "Saving…" : "Save"}
              </button>
              <button onClick={test} disabled={!!busy || !s.makeWebhookUrl} className="rounded-lg border border-border px-3.5 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50">
                {busy === "test" ? "Sending…" : "Send test payload"}
              </button>
            </>
          )}
          {msg && <span className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</span>}
        </div>
        <p className="text-xs text-neutral-400">
          AI (document reading &amp; step drafting): {aiConfigured ? "configured ✓" : "not configured — set ANTHROPIC_API_KEY on the server"}
        </p>
      </div>
    </section>
  );
}

function UsersSection({ me }: { me: Me }) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "manager" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () =>
    fetch("/api/users")
      .then((r) => r.json())
      .then((d) => setUsers(d.users || []));
  useEffect(() => {
    void load();
  }, []);

  async function add() {
    setMsg(null);
    const res = await fetch("/api/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const d = await res.json();
    if (!res.ok) return setMsg({ ok: false, text: d.error || "Couldn't add user" });
    setMsg({ ok: true, text: `Added ${d.user.name}. Share their temporary password with them — they can change it in Settings.` });
    setForm({ name: "", email: "", password: "", role: "manager" });
    void load();
  }

  async function update(id: string, body: Record<string, string>) {
    setMsg(null);
    const res = await fetch(`/api/users/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json();
    if (!res.ok) return setMsg({ ok: false, text: d.error || "Couldn't update user" });
    setMsg({ ok: true, text: body.password ? "Password reset." : "Updated." });
    void load();
  }

  function resetPassword(u: UserRow) {
    const pw = prompt(`New temporary password for ${u.name} (min 8 characters):`);
    if (pw) void update(u.id, { password: pw });
  }

  return (
    <section>
      <h2 className="text-sm font-semibold mb-1">Users</h2>
      <p className="text-xs text-neutral-500 mb-3">
        Project managers build TAs; H&amp;S reviewers approve them (and can&apos;t approve their own); admins manage settings and users.
      </p>
      <div className="bg-card border border-border rounded-xl divide-y divide-border mb-3">
        {users.map((u) => (
          <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
            <div>
              <p className="font-medium text-neutral-800">
                {u.name} {u.id === me.id && <span className="text-xs text-neutral-400">(you)</span>}
              </p>
              <p className="text-xs text-neutral-400">{u.email}</p>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={u.role}
                disabled={u.id === me.id}
                onChange={(e) => update(u.id, { role: e.target.value })}
                className="rounded-md border border-border px-2 py-1 text-xs bg-white"
              >
                {USER_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
              <button onClick={() => resetPassword(u)} className="text-xs text-accent hover:underline">
                Reset password
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="bg-card border border-border rounded-xl p-4">
        <p className="text-xs font-medium text-neutral-500 mb-2">Add a user</p>
        <div className="grid sm:grid-cols-2 gap-2">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name" className={inputCls} />
          <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Email" type="email" className={inputCls} />
          <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Temporary password (min 8)" className={inputCls} />
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={inputCls}>
            {USER_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
        <button onClick={add} className="mt-2 rounded-lg bg-accent text-white px-3.5 py-2 text-sm font-medium hover:bg-indigo-700">
          Add user
        </button>
        {msg && <p className={`text-sm mt-2 ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</p>}
      </div>
    </section>
  );
}

function PasswordSection() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function change() {
    setMsg(null);
    const res = await fetch("/api/auth/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: current, newPassword: next }),
    });
    const d = await res.json();
    if (!res.ok) return setMsg({ ok: false, text: d.error || "Couldn't change password" });
    setCurrent("");
    setNext("");
    setMsg({ ok: true, text: "Password changed." });
  }

  return (
    <section>
      <h2 className="text-sm font-semibold mb-1">Change your password</h2>
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="grid sm:grid-cols-2 gap-2">
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="Current password" className={inputCls} />
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="New password (min 8)" className={inputCls} />
        </div>
        <button onClick={change} disabled={!current || next.length < 8} className="mt-2 rounded-lg border border-border px-3.5 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50">
          Change password
        </button>
        {msg && <p className={`text-sm mt-2 ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</p>}
      </div>
    </section>
  );
}
