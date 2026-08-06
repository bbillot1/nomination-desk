import { Fragment } from "react";

import { parseSummaryTokens } from "../lib/audit-presentation";

interface EventSummaryProps {
  summary: string;
}

export function EventSummary({ summary }: EventSummaryProps) {
  return (
    <>
      {parseSummaryTokens(summary).map((token, index) => {
        const key = `${token.kind}:${index}`;
        if (token.kind === "strong") {
          return <strong key={key} className="font-semibold text-[#eef5f2]">{token.text}</strong>;
        }
        if (token.kind === "code") {
          return (
            <code
              key={key}
              className="mono rounded bg-[#172721] px-1 py-0.5 text-[0.92em] text-emerald-200/85"
            >
              {token.text}
            </code>
          );
        }
        return <Fragment key={key}>{token.text}</Fragment>;
      })}
    </>
  );
}
