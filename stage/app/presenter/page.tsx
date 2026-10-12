import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * The presenter's door, no longer a page of its own. On a server this path asks for the presenter
 * password (Caddyfile, deploy/netcup), and the login covers the whole site from here on, so the
 * board's run sheet can pull the levers. It sends the browser back to the board with the run
 * sheet unlocked. A #k=<token> from scripts/demo.sh survives the redirect.
 */
export default function Presenter() {
  redirect("/?controls=1");
}
