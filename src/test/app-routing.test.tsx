import { QueryClient } from "@tanstack/react-query";
import { createRouter, rootRouteId } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { routeTree } from "@/routeTree.gen";

// Match routes without running loaders or rendering: loaders may need a server or
// network the test run lacks, and jsdom never loads the stylesheets React waits on.
describe("App routing", () => {
  it("matches a page for / instead of falling back to not found", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

    const matches = router.matchRoutes("/");

    expect(matches.at(-1)?.routeId).not.toBe(rootRouteId);
  });

  it("routes the AI setup step and Settings, where the key can be changed", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

    expect(router.matchRoutes("/setup").at(-1)?.routeId).toBe("/setup");
    expect(router.matchRoutes("/settings").at(-1)?.routeId).toBe("/settings");
  });

  it("serves the legal pages and the consent screen without a session", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

    for (const path of ["/terms", "/privacy", "/welcome"]) {
      expect(router.matchRoutes(path).at(-1)?.routeId).toBe(path);
    }
  });
});
