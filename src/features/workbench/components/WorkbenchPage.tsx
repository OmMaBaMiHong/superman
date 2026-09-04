'use client';

import { FolderOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '../../../store/appStore';
import PublishCenterPage from '@/features/publish-center/components/PublishCenterPage';
import KnowledgePage from '@/features/knowledge/components/KnowledgePage';
import WorkspaceSection from './WorkspaceSection';
import DouyinDataSection from './DouyinDataSection';
import { WORKBENCH_TABS } from './WorkbenchMenu';

/**
 * 工作台 —— 个人创作工作台。
 *
 * 包含多个分区：
 * - 工作区：上传视频 / 文章 / 文件素材，视频支持文案提取与去剪辑；
 * - 发布：把已上传的视频一键发布到各大平台；
 * - 抖音数据：抖音视频的抓取 / 评论 / 数据看板；
 * - 知识库：个人知识库的向量检索与问答。
 *
 * 子 Tab 状态提升到 appStore（workbenchTab），与最左侧边栏的「工作台」菜单目录联动。
 */
export default function WorkbenchPage() {
  const workbenchTab = useAppStore((state) => state.workbenchTab);
  const setWorkbenchTab = useAppStore((state) => state.setWorkbenchTab);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
      {/* 标题区 */}
      <header className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[linear-gradient(135deg,var(--color-primary),color-mix(in_oklab,var(--color-primary)_72%,white_28%))] text-primary-foreground">
          <FolderOpen className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">工作台</h1>
          <p className="text-sm text-muted-foreground">管理你的创作素材，一键发布到各大平台</p>
        </div>
      </header>

      {/* 分区切换 */}
      <div className="flex gap-2">
        {WORKBENCH_TABS.map((item) => {
          const active = item.id === workbenchTab;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setWorkbenchTab(item.id)}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm transition-colors',
                active
                  ? 'border-primary bg-[color-mix(in_oklab,var(--color-primary)_12%,transparent)] text-primary'
                  : 'border-border/80 text-muted-foreground hover:border-primary/40 hover:text-foreground',
              )}
            >
              <item.Icon className="h-4 w-4" />
              {item.name}
            </button>
          );
        })}
      </div>

      {workbenchTab === 'workspace' ? (
        <WorkspaceSection />
      ) : workbenchTab === 'douyin' ? (
        <DouyinDataSection />
      ) : workbenchTab === 'knowledge' ? (
        <KnowledgePage />
      ) : (
        <PublishCenterPage />
      )}
    </div>
  );
}
