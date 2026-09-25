"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import type { SessionUser } from "@/lib/auth";
import ChatPanel from "@/components/ChatPanel";
import { ROLE_LABELS } from "@/lib/roles";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/register", label: "Risk register" },
  { href: "/tas", label: "Task analyses" },
  { href: "/settings", label: "Settings" },
];

export default function Shell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [chatOpen, setChatOpen] = useState(false);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b border-border bg-card/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-5 h-14 flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2.5 shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element -- small static logo, no optimisation needed */}
            <img src="/sansom-logo.jpg" alt="Sansom" className="h-5 w-auto" />
            <span className="font-medium text-xs text-neutral-500 tracking-tight hidden md:inline">Risk Register</span>
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            {NAV.map((item) => {
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-3 py-1.5 rounded-md transition ${
                    active ? "bg-accent-soft text-accent font-medium" : "text-neutral-600 hover:bg-neutral-100"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <button
              onClick={() => setChatOpen(true)}
              className="flex items-center gap-1.5 rounded-full bg-accent text-white text-xs font-medium px-3 py-1.5 hover:bg-indigo-700 transition"
            >
              <span className="text-sm">✦</span> Ask Risk AI
            </button>
            <span className="text-xs text-neutral-500 hidden sm:inline">{user.name} · {ROLE_LABELS[user.role] ?? user.role}</span>
            <button onClick={logout} className="text-xs text-neutral-500 hover:text-neutral-800">
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-7xl w-full mx-auto px-5 py-6">{children}</main>
      <ChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />
    </div>
  );
}
