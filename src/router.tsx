import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    // Start loading a page when the finger lands or the mouse hovers, so the
    // data-backed pages (models, legal) are usually ready by the click.
    defaultPreload: "intent",
  });

  return router;
};
