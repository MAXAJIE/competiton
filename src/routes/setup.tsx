import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, KeyRound } from "lucide-react";
import { Page, Headline } from "@/components/Reveal";
import { InteractiveCard } from "@/components/InteractiveCard";
import { AiAccessPanel } from "@/components/AiAccessPanel";
import { useStore } from "@/lib/store";
import { getAiSettings } from "@/lib/ai";

export const Route = createFileRoute("/setup")({
  head: () => ({
    meta: [
      { title: "Set up AI access — Cashflow" },
      {
        name: "description",
        content:
          "Choose whether AI features use this server's OpenRouter key or your own before you start.",
      },
    ],
  }),
  component: Setup,
});

/**
 * The one screen a new account sees before the dashboard: pick an AI key source.
 *
 * It is a landing step, not a gate — either choice is a valid answer, and the
 * same switch lives in Settings so nobody is trapped by what they picked here.
 */
function Setup() {
  const { mode, loaded } = useStore();
  const navigate = useNavigate();
  // Rendered only once we know the choice is still open; avoids painting the
  // form for a single frame to someone who already configured it.
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (getAiSettings()) {
      navigate({ to: "/", replace: true });
      return;
    }
    if (!loaded) return;
    if (mode === null) {
      navigate({ to: "/login", replace: true });
      return;
    }
    setShow(true);
  }, [loaded, mode, navigate]);

  if (!show) return null;

  return (
    <Page>
      <Headline eyebrow="One last step" lines={["Choose how AI", "runs for you."]} />

      <div data-reveal className="mb-6 max-w-2xl">
        <p className="lede">
          Scans and the advisor need an OpenRouter key. Use the one this server already has, or plug
          in your own — you can change this any time in Settings.
        </p>
      </div>

      <InteractiveCard ribbon={false} className="surface p-5 sm:p-7">
        <div className="mb-6 flex items-start gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
            <KeyRound className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="eyebrow">AI access</p>
            <h2 className="mt-1 text-2xl">Where should the key come from?</h2>
            <p className="mt-1 lede">
              OpenRouter only, for now. Nothing leaves this browser except the HTTP request that
              carries it.
            </p>
          </div>
        </div>

        <AiAccessPanel onSaved={() => navigate({ to: "/" })} />
      </InteractiveCard>

      <p
        data-reveal
        className="mt-5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
      >
        <span>Already set up and want to change it later?</span>
        <Link
          to="/settings"
          className="inline-flex items-center gap-1 font-medium text-indigo-600 hover:underline"
        >
          Open Settings <ArrowRight className="h-3 w-3" aria-hidden />
        </Link>
      </p>
    </Page>
  );
}
