import ReactMarkdown from "react-markdown";

/** Report prose is content, never an app capability or an external request. */
export function SafeMarkdown({ children }: { children: string }) {
  return (
    <div className="report-prose">
      <ReactMarkdown
        skipHtml
        disallowedElements={[
          "img",
          "iframe",
          "script",
          "style",
          "object",
          "video",
          "audio",
        ]}
        components={{
          a: ({ children, href }) => (
            <span className="report-link" title={href}>
              {children}
            </span>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
