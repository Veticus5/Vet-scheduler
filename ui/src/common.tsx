import { useCallback, useEffect, useState } from "react";
import { STAFF_GROUPS, type StaffGroupKey, type Weekday } from "@vet/shared";

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  0: "Nd",
  1: "Pn",
  2: "Wt",
  3: "Śr",
  4: "Cz",
  5: "Pt",
  6: "So",
};

export function groupLabel(key: StaffGroupKey): string {
  return STAFF_GROUPS.find((g) => g.key === key)?.label ?? key;
}

export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Minimal data-loading hook with reload + error surface. */
export function useLoader<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    loader()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(reload, [reload]);
  return { data, error, loading, reload, setError };
}

export function Banner({ kind, children }: { kind: "error" | "ok" | "warn"; children: React.ReactNode }) {
  return <div className={`banner ${kind}`}>{children}</div>;
}
