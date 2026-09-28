/** Format a selector label without changing the report's authored title. */
export function formatReportOption(item: {
  prNumber: number | null;
  title: string;
  head: string;
}): string {
  let title = item.title.trim();
  if (item.prNumber !== null) {
    const prefix = title.match(
      /^(?:PR|Pull\s+request)\s*#?\s*(\d+)(?:\s*[—–:·-]\s*|$)/i,
    );
    if (prefix && Number(prefix[1]) === item.prNumber) {
      title = title.slice(prefix[0].length).trim();
    }
  }
  return [
    item.prNumber === null ? "Branch review" : `PR #${item.prNumber}`,
    title,
    item.head.slice(0, 7),
  ]
    .filter(Boolean)
    .join(" · ");
}
