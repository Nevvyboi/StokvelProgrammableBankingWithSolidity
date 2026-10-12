import { NextResponse } from "next/server";
import { serverConfig } from "@/lib/serverConfig";

export const dynamic = "force-dynamic";

/** The stage app's configuration: env first, the Foundry deployment file for the rest. */
export function GET() {
  return NextResponse.json(serverConfig());
}
