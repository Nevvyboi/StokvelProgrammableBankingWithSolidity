/**
 * The board can blow one section up to fill the screen: keys 1 to 5, a click on the section, or
 * the run sheet's "Screen" buttons. 0, Esc or a click goes back to everything.
 */
export type Focus = "bank" | "roster" | "pot" | "minutes" | "quilt";

export const FOCUS: { key: string; id: Focus; label: string }[] = [
  { key: "1", id: "bank", label: "Bank statement" },
  { key: "2", id: "pot", label: "Pot and reconciliation" },
  { key: "3", id: "roster", label: "Roster" },
  { key: "4", id: "minutes", label: "Minute book" },
  { key: "5", id: "quilt", label: "Quilt" },
];
