export type MemberInfo = { memberId: number; number: string; name: string; colour: string };

export const MEMBERS: MemberInfo[] = [
  { memberId: 0, number: "01", name: "Lerato", colour: "#F4A261" },
  { memberId: 1, number: "02", name: "Thabo", colour: "#2A9D8F" },
  { memberId: 2, number: "03", name: "Aisha", colour: "#E76F51" },
  { memberId: 3, number: "04", name: "Johan", colour: "#8AB17D" },
  { memberId: 4, number: "05", name: "Priya", colour: "#B388EB" },
  { memberId: 5, number: "06", name: "Sipho", colour: "#E9C46A" },
];

export function member(memberId: number | bigint): MemberInfo {
  const id = Number(memberId);
  return MEMBERS[id] ?? { memberId: id, number: String(id + 1).padStart(2, "0"), name: `Member ${id + 1}`, colour: "#8A96AD" };
}

export function formatRands(cents: bigint | number | string): string {
  const c = BigInt(cents);
  const neg = c < 0n;
  const abs = neg ? -c : c;
  const whole = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (abs % 100n).toString().padStart(2, "0");
  return `${neg ? "-" : ""}R${whole}.${frac}`;
}

export function formatRandsShort(cents: bigint | number | string): string {
  const c = BigInt(cents);
  if (c % 100n === 0n) return `R${(c / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
  return formatRands(c);
}

export function short(hex: string, n = 6): string {
  return hex.length > 2 * n + 2 ? `${hex.slice(0, n + 2)}…${hex.slice(-n)}` : hex;
}
