export function VitanaBrand({ variant }: { variant: "nav" | "rail" }) {
  return (
    <div className={`vitana-brand vitana-brand-${variant}`} aria-label="Vitana Health">
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
    </div>
  );
}