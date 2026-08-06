export function ProLockedView({ feature }: { feature: string }) {
  return (
    <section className="pro-locked-view" aria-labelledby="pro-locked-title">
      <span className="pro-locked-label">Vitana Pro</span>
      <h2 id="pro-locked-title">Available in Vitana Pro</h2>
      <p>{feature} is included with the one-time Vitana Pro unlock.</p>
    </section>
  );
}