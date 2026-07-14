import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { invoke } from "@tauri-apps/api/core";
import { Component, createContext, useContext, useEffect, useMemo } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { useWorkspaceStore } from "../stores/workspace-store";

type WorkspaceRouterRenderers = {
  renderList: () => ReactNode;
  renderDetail: (clipId: string) => ReactNode;
  renderAggregate: () => ReactNode;
  fallbackCopy: WorkspaceFallbackCopy;
};

type WorkspaceFallbackCopy = {
  routeTitle: string;
  routeMessage: string;
  providerTitle: string;
  providerMessage: string;
  backToList: string;
  retry: string;
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

function appendWorkspaceRouteLog(level: "info" | "warn" | "error", message: string, context: Record<string, unknown>) {
  let contextText = "";
  try {
    contextText = JSON.stringify(context);
  } catch {
    contextText = String(context);
  }
  void invoke("append_app_log", { level, message, context: contextText }).catch(() => {
    // Logging must not become another route failure source.
  });
}

function getWorkspaceRouteDiagnostics(extra: Record<string, unknown> = {}) {
  const route = useWorkspaceStore.getState().route;
  return {
    businessChain: "quick-panel -> workspace-router -> tab-route -> route-renderer",
    component: "WorkspaceRouterProvider",
    routeName: route.name,
    clipId: route.clipId,
    ...extra,
  };
}

function WorkspaceRouteError({ error, reset }: ErrorComponentProps) {
  const renderers = useContext(WorkspaceRendererContext);
  const copy = renderers?.fallbackCopy;
  const message = error instanceof Error ? error.message : String(error);

  useEffect(() => {
    appendWorkspaceRouteLog(
      "error",
      "workspace-route-error",
      getWorkspaceRouteDiagnostics({
        boundary: "tanstack-route-errorComponent",
        errorMessage: message,
        errorName: error instanceof Error ? error.name : typeof error,
      }),
    );
  }, [error, message]);

  return (
    <section className="workspace-route-fallback" role="alert">
      <strong>{copy?.routeTitle ?? "Workspace route failed"}</strong>
      <span title={message}>{copy?.routeMessage ?? "Panel state is preserved. Return to the list to continue."}</span>
      <div>
        <button
          type="button"
          onClick={() => {
            reset();
            void navigateWorkspaceList();
          }}
        >
          {copy?.backToList ?? "Back to list"}
        </button>
        <button type="button" onClick={reset}>
          {copy?.retry ?? "Retry"}
        </button>
      </div>
    </section>
  );
}

class WorkspaceProviderBoundary extends Component<{ children: ReactNode; copy: WorkspaceFallbackCopy }, { failed: boolean; message: string }> {
  state = { failed: false, message: "" };

  static getDerivedStateFromError(error: Error) {
    return { failed: true, message: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Workspace router failed", error, info.componentStack);
    appendWorkspaceRouteLog(
      "error",
      "workspace-provider-boundary-error",
      getWorkspaceRouteDiagnostics({
        boundary: "workspace-provider-boundary",
        errorMessage: error.message,
        errorName: error.name,
        componentStack: info.componentStack,
      }),
    );
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <section className="workspace-route-fallback" role="alert">
        <strong>{this.props.copy.providerTitle}</strong>
        <span title={this.state.message}>{this.props.copy.providerMessage}</span>
        <div>
          <button
            type="button"
            onClick={() => {
              this.setState({ failed: false, message: "" });
              void navigateWorkspaceList();
            }}
          >
            {this.props.copy.backToList}
          </button>
          <button type="button" onClick={() => this.setState({ failed: false, message: "" })}>
            {this.props.copy.retry}
          </button>
        </div>
      </section>
    );
  }
}

const rootRoute = createRootRoute({
  component: WorkspaceRoot,
  errorComponent: WorkspaceRouteError,
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
  defaultErrorComponent: WorkspaceRouteError,
  disableGlobalCatchBoundary: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof workspaceRouter;
  }
}

export function WorkspaceRouterProvider({
  fallbackCopy,
  renderAggregate,
  renderDetail,
  renderList,
}: WorkspaceRouterRenderers) {
  const renderers = useMemo(
    () => ({ fallbackCopy, renderAggregate, renderDetail, renderList }),
    [fallbackCopy, renderAggregate, renderDetail, renderList],
  );

  return (
    <WorkspaceRendererContext.Provider value={renderers}>
      <WorkspaceProviderBoundary copy={renderers.fallbackCopy}>
        <RouterProvider router={workspaceRouter} />
      </WorkspaceProviderBoundary>
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
