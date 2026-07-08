import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { createContext, useContext, useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "../stores/workspace-store";

type WorkspaceRouterRenderers = {
  renderList: () => ReactNode;
  renderDetail: (clipId: string) => ReactNode;
  renderAggregate: () => ReactNode;
};

const WorkspaceRendererContext = createContext<WorkspaceRouterRenderers | null>(null);

function useWorkspaceRenderers() {
  const renderers = useContext(WorkspaceRendererContext);
  if (!renderers) throw new Error("WorkspaceRouterProvider is missing renderers");
  return renderers;
}

function WorkspaceRoot() {
  return <Outlet />;
}

function WorkspaceListRoute() {
  const renderers = useWorkspaceRenderers();
  useEffect(() => {
    useWorkspaceStore.getState().setListRoute();
  }, []);
  return <>{renderers.renderList()}</>;
}

function WorkspaceDetailRoute() {
  const renderers = useWorkspaceRenderers();
  const { clipId } = detailRoute.useParams();
  useEffect(() => {
    useWorkspaceStore.getState().setDetailRoute(clipId);
  }, [clipId]);
  return <>{renderers.renderDetail(clipId)}</>;
}

function WorkspaceAggregateRoute() {
  const renderers = useWorkspaceRenderers();
  useEffect(() => {
    useWorkspaceStore.getState().setAggregateRoute();
  }, []);
  return <>{renderers.renderAggregate()}</>;
}

const rootRoute = createRootRoute({
  component: WorkspaceRoot,
});

const listRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: WorkspaceListRoute,
});

const detailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/clip/$clipId",
  component: WorkspaceDetailRoute,
});

const aggregateRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/aggregate",
  component: WorkspaceAggregateRoute,
});

const routeTree = rootRoute.addChildren([listRoute, detailRoute, aggregateRoute]);

export const workspaceRouter = createRouter({
  routeTree,
  history: createMemoryHistory({ initialEntries: ["/"] }),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof workspaceRouter;
  }
}

export function WorkspaceRouterProvider({
  renderAggregate,
  renderDetail,
  renderList,
}: WorkspaceRouterRenderers) {
  const renderers = useMemo(
    () => ({ renderAggregate, renderDetail, renderList }),
    [renderAggregate, renderDetail, renderList],
  );

  return (
    <WorkspaceRendererContext.Provider value={renderers}>
      <RouterProvider router={workspaceRouter} />
    </WorkspaceRendererContext.Provider>
  );
}

export function navigateWorkspaceList() {
  useWorkspaceStore.getState().setListRoute();
  return workspaceRouter.navigate({ to: "/" });
}

export function navigateWorkspaceDetail(clipId: string) {
  useWorkspaceStore.getState().setDetailRoute(clipId);
  return workspaceRouter.navigate({ to: "/clip/$clipId", params: { clipId } });
}

export function navigateWorkspaceAggregate() {
  useWorkspaceStore.getState().setAggregateRoute();
  return workspaceRouter.navigate({ to: "/aggregate" });
}
