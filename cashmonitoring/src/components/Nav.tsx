import { Link } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
const links = [["/", "Dashboard"], ["/advisor", "Advisor"], ["/entry", "Entry"], ["/settings", "Settings"]] as const;
export function Nav() {
  const { mode } = useStore();
  return (
    <nav className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link to="/" className="font-display text-2xl">Cash<span className="italic text-accent">Monitoring</span></Link>
        <div className="flex items-center gap-6 text-sm">
          {links.map(([to, l]) => <Link key={to} to={to} activeOptions={{ exact: true }} className="text-muted-foreground hover:text-foreground [&.active]:text-foreground [&.active]:underline underline-offset-8">{l}</Link>)}
          <Link to="/login" className="eyebrow border px-2 py-1">{mode === "guest" ? "Guest" : mode === "user" ? "Signed in" : "Sign in"}</Link>
        </div>
      </div>
    </nav>
  );
}
