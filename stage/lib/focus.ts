/**
 * The projector can blow one section up to fill the screen. Keys 1 to 5 on the projector, a click
 * on a section, or the presenter panel's buttons (over the "stokvel-stage" BroadcastChannel, so
 * the presenter window must be in the same browser, as it is on the laptop driving the projector).
 */
export type Focus = "bank" | "roster" | "pot" | "minutes" | "quilt";

export const FOCUS: { key: string; id: Focus; label: string }[] = [
  { key: "1", id: "bank", label: "Bank statement" },
  { key: "2", id: "pot", label: "Pot and reconciliation" },
  { key: "3", id: "roster", label: "Roster" },
  { key: "4", id: "minutes", label: "Minute book" },
  { key: "5", id: "quilt", label: "Quilt" },
];
