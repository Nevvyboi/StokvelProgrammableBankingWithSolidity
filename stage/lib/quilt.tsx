import type { CSSProperties } from "react";

/**
 * The quilt motif. Each patch is a small pieced block in a member's colour, deterministic from a
 * seed, so the same contribution draws the same patch on the dashboard, the cards and the deck.
 * Blocks are square with no rounding: fabric, not UI.
 */
export const PALETTE = {
  bg: "#0B1426",
  surface: "#13203A",
  text: "#F4F1EA",
  muted: "#8A96AD",
  primary: "#2EC4B6",
  danger: "#FF5A5F",
  success: "#3DDC97",
};

function rng(seed: number) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10_000) / 10_000;
  };
}

export function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + (amount > 0 ? (255 - c) * amount : c * amount))));
  return `#${[f(r), f(g), f(b)].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

export type PatchCell = { x: number; y: number; kind: "tri" | "square" | "half" | "dot" | "empty"; rot: number; tone: number };

/** Pure data, so the same function renders to React SVG, to a PDF (cards) and to PNG (deck). */
export function patchCells(seed: number, n = 4): PatchCell[] {
  const r = rng(seed);
  const cells: PatchCell[] = [];
  const symmetric = r() > 0.3;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const sx = symmetric && x >= n / 2 ? n - 1 - x : x;
      const cellSeed = symmetric ? hashSeed(`${seed}:${sx}:${y}`) : hashSeed(`${seed}:${x}:${y}`);
      const rr = rng(cellSeed);
      const k = rr();
      const kind: PatchCell["kind"] = k < 0.42 ? "tri" : k < 0.64 ? "square" : k < 0.82 ? "half" : k < 0.9 ? "dot" : "empty";
      let rot = Math.floor(rr() * 4);
      if (symmetric && x >= n / 2 && (kind === "tri" || kind === "half")) rot = (5 - rot) % 4;
      cells.push({ x, y, kind, rot, tone: Math.floor(rr() * 3) });
    }
  }
  return cells;
}

export function patchColours(colour: string): string[] {
  return [colour, shade(colour, -0.4), shade(colour, 0.3)];
}

export function Patch({
  colour,
  seed,
  size = 48,
  n = 4,
  style,
  className,
  base = PALETTE.surface,
}: {
  colour: string;
  seed: number | string;
  size?: number;
  n?: number;
  style?: CSSProperties;
  className?: string;
  base?: string;
}) {
  const s = typeof seed === "string" ? hashSeed(seed) : seed;
  const cells = patchCells(s, n);
  const tones = patchColours(colour);
  const c = 100 / n;
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} style={style} className={className} aria-hidden shapeRendering="crispEdges">
      <rect width="100" height="100" fill={base} />
      {cells.map((cell, i) => {
        const x = cell.x * c, y = cell.y * c;
        const fill = tones[cell.tone]!;
        const t = `rotate(${cell.rot * 90} ${x + c / 2} ${y + c / 2})`;
        if (cell.kind === "empty") return null;
        if (cell.kind === "square") return <rect key={i} x={x} y={y} width={c} height={c} fill={fill} />;
        if (cell.kind === "tri") return <polygon key={i} points={`${x},${y} ${x + c},${y} ${x},${y + c}`} fill={fill} transform={t} />;
        if (cell.kind === "half") return <rect key={i} x={x} y={y} width={c} height={c / 2} fill={fill} transform={t} />;
        return <circle key={i} cx={x + c / 2} cy={y + c / 2} r={c / 3} fill={fill} />;
      })}
    </svg>
  );
}
