import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getPendingTasks, type Profile } from "@/lib/lms";
import { TASKS_CHANGED_EVENT } from "@/lib/pending-tasks";

export function usePendingTasks(profile: Profile) {
  const client = useQueryClient();
  useEffect(() => {
    const refresh = () => {
      void client.invalidateQueries({ queryKey: ["pending-tasks"] });
    };
    window.addEventListener(TASKS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(TASKS_CHANGED_EVENT, refresh);
  }, [client]);
  return useQuery({
    queryKey: ["pending-tasks", profile.id, profile.role],
    queryFn: getPendingTasks,
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: "always",
  }).data;
}
