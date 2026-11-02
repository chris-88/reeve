import { useQuery } from "@tanstack/react-query";
import type { Area } from "@reeve/shared";
import { supabase } from "@/lib/supabase";

/**
 * The live areas, in order — one query for every screen.
 *
 * Active only (BR-0). Areas are realigned to the vault's domains by retiring
 * the old ids rather than deleting them, because actions, captures and
 * commitments reference them by foreign key. Triage already ignores an
 * inactive area; without this filter the app would still list six dead ones in
 * every picker and chip row. An old capture filed under a retired area simply
 * shows no area label, which is honest.
 */
export function useAreas() {
  return useQuery({
    queryKey: ["areas"],
    staleTime: Infinity,
    queryFn: async (): Promise<Area[]> => {
      const { data, error } = await supabase
        .from("areas")
        .select("*")
        .eq("active", true)
        .order("sort_order");
      if (error) throw error;
      return data;
    },
  });
}
