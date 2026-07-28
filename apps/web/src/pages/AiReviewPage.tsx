import { safetyNotice, type Insight } from "@vitana/shared";
import { MarkdownText } from "../components/MarkdownText.js";
import { formatShortTimestamp } from "../utils.js";

export function AiReviewPage({
  busy,
  latestInsight,
  onGenerateInsight
}: {
  busy: boolean;
  latestInsight?: Insight;
  onGenerateInsight: () => void;
}) {
  return (
    <section className="ai-review">
      <h2>AI review</h2>
      <p className="safety">{safetyNotice}</p>
      <div className="ai-review-actions">
        <button disabled={busy} onClick={onGenerateInsight}>Generate insights</button>
        <p className="ai-review-generated" aria-label={latestInsight?.createdAt ? `Last generated ${formatShortTimestamp(latestInsight.createdAt)}` : "Last generated not available"}>
          Last generated: {latestInsight?.createdAt ? formatShortTimestamp(latestInsight.createdAt) : "Not generated yet"}
        </p>
      </div>
      {latestInsight ? (
        <div className="insight">
          <span>{latestInsight.model} / confidence {latestInsight.confidence}</span>
          <h3>{latestInsight.title}</h3>
          <MarkdownText>{latestInsight.body}</MarkdownText>
        </div>
      ) : <p className="empty">Generate an insight after importing data.</p>}
    </section>
  );
}