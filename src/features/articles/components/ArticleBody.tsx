'use client';

import { forwardRef, type KeyboardEvent, type MouseEvent } from "react";
import { cn } from "@/lib/utils";

interface ArticleBodyProps {
  bodyHtml: string;
  fontSizeClass: string;
  lineHeightClass: string;
  fontFamilyClass: string;
  onClick: (event: MouseEvent<HTMLDivElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}

const ArticleBody = forwardRef<HTMLDivElement, ArticleBodyProps>(
  function ArticleBody(
    {
      bodyHtml,
      fontSizeClass,
      lineHeightClass,
      fontFamilyClass,
      onClick,
      onKeyDown,
    },
    ref,
  ) {
    const articleBodyMarkup = { __html: bodyHtml };

    return (
      <div
        ref={ref}
        className={cn(
          // Tighten article typography contrast without making the surrounding UI feel heavier.
          "prose max-w-none prose-headings:text-foreground/94 prose-headings:font-semibold prose-p:text-foreground/84 prose-p:font-[450] prose-li:text-foreground/84 prose-li:font-[450] prose-strong:text-foreground/96 prose-blockquote:border-border/90 prose-blockquote:text-foreground/84 prose-figcaption:text-muted-foreground prose-a:text-foreground/94 prose-a:decoration-primary/45 prose-video:my-5 prose-video:w-full prose-video:max-w-full prose-video:rounded-lg prose-video:bg-black dark:prose-invert",
          fontSizeClass,
          lineHeightClass,
          fontFamilyClass,
        )}
        data-testid="article-html-content"
        onClickCapture={onClick}
        onKeyDownCapture={onKeyDown}
        dangerouslySetInnerHTML={articleBodyMarkup}
      />
    );
  },
);

export default ArticleBody;