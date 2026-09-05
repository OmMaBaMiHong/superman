import { FileText, Image as ImageIcon, Play } from 'lucide-react';
import type { ContentType } from '@/lib/api/apiClient';
import { cn } from '@/lib/utils';

const COPY: Record<ContentType, { label: string; Icon: typeof Play }> = {
  video: { label: '视频', Icon: Play },
  image: { label: '图文', Icon: ImageIcon },
  text: { label: '文案', Icon: FileText },
};

/** 内容形态徽章（图文/视频/文案；预留直播位由后端 contentType 扩展）。 */
export default function ContentTypeBadge({
  type,
  className,
}: {
  type: ContentType;
  className?: string;
}) {
  const { label, Icon } = COPY[type] ?? COPY.text;
  return (
    <span
      data-testid="content-type-badge"
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-border px-1.5',
        'bg-secondary text-[10px] font-medium text-secondary-foreground',
        className,
      )}
    >
      <Icon aria-hidden="true" className="h-2.5 w-2.5" />
      {label}
    </span>
  );
}
