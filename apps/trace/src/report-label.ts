/** Remove only a redundant PR prefix; keep the authored report unchanged. */
export function reportDisplayTitle(
  authoredTitle: string,
  prNumber: number | null,
): string {
  let title = authoredTitle.trim();
  if (prNumber !== null) {
    const prefix = title.match(
      /^(?:PR|Pull\s+request)\s*#?\s*(\d+)(?:\s*[—–:·-]\s*|$)/i,
    );
    if (prefix && Number(prefix[1]) === prNumber) {
      title = title.slice(prefix[0].length).trim();
    }
  }
  return title;
}

/** Format a selector label without changing the report's authored title. */
export function formatReportOption(item: {
  prNumber: number | null;
  title: string;
  head: string;
}): string {
  const title = reportDisplayTitle(item.title, item.prNumber);
  return [
    item.prNumber === null ? "Branch review" : `PR #${item.prNumber}`,
    title,
    item.head.slice(0, 7),
  ]
    .filter(Boolean)
    .join(" · ");
}
