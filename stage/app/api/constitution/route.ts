import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** The exact text whose hash the contract holds. The signing station signs this string. */
export function GET() {
  const text = readFileSync(resolve(process.cwd(), "..", "contracts", "CONSTITUTION.md"), "utf8");
  return NextResponse.json({ text });
}
