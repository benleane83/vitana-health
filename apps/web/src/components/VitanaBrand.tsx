import type { KeyboardEvent } from "react";

export function VitanaBrand({
  variant,
  active = false,
  id,
  onClick,
  onKeyDown
}: {
  variant: "nav" | "rail";
  active?: boolean;
  id?: string;
  onClick?: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  const brandContent = (
    <>
      <div className="vitana-brand-symbol" aria-hidden="true">
        <div className="vitana-mark">
          <span className="vitana-petal vitana-petal-top" />
          <span className="vitana-petal vitana-petal-left" />
          <span className="vitana-petal vitana-petal-right" />
          <span className="vitana-stem" />
          <span className="vitana-core" />
        </div>
      </div>
      <span className="vitana-brand-name">Vitana</span>
      {variant === "rail" ? <span className="vitana-brand-tagline">All Your Health. In One Place.</span> : null}
    </>
  );

  if (variant === "nav") {
    return (
      <button
        type="button"
        id={id}
        role="tab"
        className={`vitana-brand vitana-brand-nav vitana-brand-button${active ? " active" : ""}`}
        aria-label="Dashboard"
        aria-selected={active}
        aria-controls="route-panel-dashboard"
        tabIndex={active ? 0 : -1}
        title="Dashboard"
        onClick={onClick}
        onKeyDown={onKeyDown}
      >
        {brandContent}
      </button>
    );
  }

  return (
    <div className="vitana-brand vitana-brand-rail" aria-label="Vitana Health">
      {brandContent}
    </div>
  );
}