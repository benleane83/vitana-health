import { useEffect, useState } from "react";

const horizontalTabQuery = "(max-width: 1050px)";

export function useResponsiveTabOrientation(): "horizontal" | "vertical" {
  const [horizontal, setHorizontal] = useState(() =>
    typeof window.matchMedia === "function" && window.matchMedia(horizontalTabQuery).matches
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mediaQuery = window.matchMedia(horizontalTabQuery);
    const update = () => setHorizontal(mediaQuery.matches);
    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, []);

  return horizontal ? "horizontal" : "vertical";
}