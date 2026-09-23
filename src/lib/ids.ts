import { randomBytes } from "node:crypto";

export function uid(prefix = ""): string {
  const rand = randomBytes(9).toString("base64url");
  return prefix ? `${prefix}_${rand}` : rand;
}

// Generates the next RSK-### style id based on the highest existing number.
export function nextRiskId(existingIds: string[]): string {
  let max = 0;
  for (const id of existingIds) {
    const m = /^RSK-(\d+)$/i.exec(id.trim());
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  const next = max + 1;
  return `RSK-${String(next).padStart(3, "0")}`;
}
