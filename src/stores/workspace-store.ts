import { create } from "zustand";

export type WorkspaceRouteState =
  | { name: "list"; clipId: null }
  | { name: "detail"; clipId: string }
  | { name: "aggregate"; clipId: null };

type WorkspaceStore = {
  route: WorkspaceRouteState;
  setListRoute: () => void;
  setDetailRoute: (clipId: string) => void;
  setAggregateRoute: () => void;
};

export const useWorkspaceStore = create<WorkspaceStore>()((set) => ({
  route: { name: "list", clipId: null },
  setListRoute: () => set({ route: { name: "list", clipId: null } }),
  setDetailRoute: (clipId) => set({ route: { name: "detail", clipId } }),
  setAggregateRoute: () => set({ route: { name: "aggregate", clipId: null } }),
}));
