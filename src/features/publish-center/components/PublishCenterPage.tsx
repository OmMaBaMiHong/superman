'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, QrCode, RefreshCw, Send, UploadCloud, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { toast } from '@/features/toast/toast';
import {
  PUBLISH_PLATFORM_KEYS,
  getPlatformName,
  getPlatformType,
  type PublishPlatformKey,
} from '@/lib/publish/platforms';
import {
  createPlatformLoginEventSource,
  listPlatformAccounts,
  parsePublishLoginData,
  publishVideo,
  uploadPublishVideo,
  type PublishAccount,
} from '../lib/api';

export default function PublishCenterPage() {
  const [platform, setPlatform] = useState<PublishPlatformKey>('douyin');

  const [accounts, setAccounts] = useState<PublishAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [description, setDescription] = useState('');
  const [publishing, setPublishing] = useState(false);

  // 扫码登录弹层
  const [loginOpen, setLoginOpen] = useState(false);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [loginStatus, setLoginStatus] = useState<'waiting' | 'success' | 'failed' | null>(null);
  const [loginMessage, setLoginMessage] = useState('');
  const loginSourceRef = useRef<EventSource | null>(null);

  const refreshAccounts = useCallback(
    async (target: PublishPlatformKey = platform) => {
      setAccountsLoading(true);
      try {
        const list = await listPlatformAccounts(target);
        const type = getPlatformType(target);
        const filtered = list.filter((account) => account.type === type);
        setAccounts(filtered);
        setSelectedAccountId((prev) => {
          if (prev !== null && filtered.some((account) => account.id === prev)) return prev;
          return filtered.length > 0 ? filtered[0].id : null;
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : '获取账号失败';
        toast.error(message);
      } finally {
        setAccountsLoading(false);
      }
    },
    [platform],
  );

  useEffect(() => {
    refreshAccounts(platform);
  }, [platform, refreshAccounts]);

  // 卸载时关闭登录流
  useEffect(() => {
    return () => {
      loginSourceRef.current?.close();
    };
  }, []);

  const handleFileChange = useCallback((file: File | undefined) => {
    setSelectedFile(file ?? null);
    setUploadedFile(null);
    if (file) {
      setTitle((prev) => prev || file.name.replace(/\.[^.]+$/, ''));
    }
  }, []);

  const handleUpload = useCallback(async () => {
    if (!selectedFile) {
      toast.error('请先选择要发布的视频文件');
      return;
    }
    setUploading(true);
    try {
      const name = await uploadPublishVideo(platform, selectedFile);
      setUploadedFile(name);
      toast.success('视频上传成功，可以填标题发布了');
    } catch (err) {
      const message = err instanceof Error ? err.message : '上传视频失败';
      toast.error(message);
    } finally {
      setUploading(false);
    }
  }, [selectedFile, platform]);

  const openLogin = useCallback(
    (account: string) => {
      setLoginOpen(true);
      setQrImage(null);
      setLoginStatus('waiting');
      setLoginMessage('');

      loginSourceRef.current?.close();
      const source = createPlatformLoginEventSource(platform, account);
      loginSourceRef.current = source;

      source.onmessage = (event) => {
        const parsed = parsePublishLoginData(event.data);
        if (!parsed) return;
        if (parsed.kind === 'qrcode') {
          setQrImage(parsed.image);
          setLoginStatus('waiting');
        } else if (parsed.kind === 'success') {
          setLoginStatus('success');
          source.close();
          loginSourceRef.current = null;
          toast.success('登录成功');
          refreshAccounts();
        } else {
          setLoginStatus('failed');
          setLoginMessage(parsed.message ?? '登录失败或超时');
          source.close();
          loginSourceRef.current = null;
        }
      };
      source.onerror = () => {
        setLoginStatus('failed');
        setLoginMessage('登录连接中断');
        source.close();
        loginSourceRef.current = null;
      };
    },
    [platform, refreshAccounts],
  );

  const closeLogin = useCallback(() => {
    loginSourceRef.current?.close();
    loginSourceRef.current = null;
    setLoginOpen(false);
  }, []);

  const handlePublish = useCallback(async () => {
    if (!uploadedFile) {
      toast.error('请先上传视频文件');
      return;
    }
    const account = accounts.find((item) => item.id === selectedAccountId);
    if (!account) {
      toast.error('请先选择要发布的账号');
      return;
    }
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      toast.error('请填写视频标题');
      return;
    }
    const tags = tagsText
      .split(/[，,]/)
      .map((tag) => tag.trim().replace(/^#/, ''))
      .filter(Boolean);

    setPublishing(true);
    try {
      await publishVideo(platform, {
        file: uploadedFile,
        title: trimmedTitle,
        tags,
        description: description.trim() || undefined,
        account: account.filePath,
      });
      toast.success(`发布指令已提交，请留意浏览器里的${getPlatformName(platform)}发布流程`);
    } catch (err) {
      const message = err instanceof Error ? err.message : '发布失败';
      toast.error(message);
    } finally {
      setPublishing(false);
    }
  }, [uploadedFile, title, tagsText, description, accounts, selectedAccountId, platform]);

  return (
    <div className="flex flex-col gap-6">
      {/* 平台切换 */}
      <section className="flex flex-wrap gap-2">
        {PUBLISH_PLATFORM_KEYS.map((key) => {
          const active = key === platform;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setPlatform(key)}
              className={cn(
                'rounded-full border px-4 py-1.5 text-sm transition-colors',
                active
                  ? 'border-primary bg-[color-mix(in_oklab,var(--color-primary)_12%,transparent)] text-primary'
                  : 'border-border/80 text-muted-foreground hover:border-primary/40 hover:text-foreground',
              )}
            >
              {getPlatformName(key)}
            </button>
          );
        })}
      </section>

      {/* 账号区 */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-foreground">
            {getPlatformName(platform)}账号
          </h2>
          <Button variant="ghost" size="sm" onClick={() => refreshAccounts()} disabled={accountsLoading}>
            <RefreshCw className={cn('h-3.5 w-3.5', accountsLoading && 'animate-spin')} />
            刷新
          </Button>
        </div>

        {accountsLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            加载账号中…
          </div>
        ) : accounts.length === 0 ? (
          <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border/80 px-4 py-6 text-center">
            <p className="text-sm text-muted-foreground">
              还没有已登录的{getPlatformName(platform)}账号，扫码登录后即可发布。
            </p>
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => openLogin('default')}>
                <QrCode className="h-4 w-4" />
                扫码登录{getPlatformName(platform)}
              </Button>
            </div>
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-border/70 rounded-xl border border-border/80">
            {accounts.map((account) => {
              const selected = account.id === selectedAccountId;
              return (
                <li
                  key={account.id}
                  className={cn(
                    'flex cursor-pointer items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-accent/60',
                    selected && 'bg-[color-mix(in_oklab,var(--color-primary)_8%,transparent)]',
                  )}
                  onClick={() => setSelectedAccountId(account.id)}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className={cn(
                        'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors',
                        selected
                          ? 'border-primary bg-primary'
                          : 'border-border bg-background',
                      )}
                    >
                      {selected && <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {account.userName || `账号 #${account.id}`}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{account.filePath}</p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(event) => {
                      event.stopPropagation();
                      openLogin(account.filePath);
                    }}
                  >
                    <QrCode className="h-3.5 w-3.5" />
                    扫码登录
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 视频上传区 */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-foreground">视频文件</h2>
        <label
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/80 px-4 py-8 text-center transition-colors hover:border-primary/40',
            selectedFile &&
              'border-solid border-primary/40 bg-[color-mix(in_oklab,var(--color-primary)_6%,transparent)]',
          )}
        >
          <UploadCloud className="h-8 w-8 text-primary/70" />
          {selectedFile ? (
            <>
              <p className="max-w-full truncate text-sm font-medium text-foreground">
                {selectedFile.name}
              </p>
              <p className="text-xs text-muted-foreground">
                {(selectedFile.size / 1024 / 1024).toFixed(1)} MB
              </p>
            </>
          ) : (
            <>
              <p className="text-sm text-foreground">点击选择要发布的视频</p>
              <p className="text-xs text-muted-foreground">
                支持 MP4 等常见格式，可重新选择覆盖
              </p>
            </>
          )}
          <input
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(event) => handleFileChange(event.target.files?.[0])}
          />
        </label>

        <div className="flex justify-end">
          <Button
            onClick={handleUpload}
            disabled={!selectedFile || uploading || !!uploadedFile}
          >
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                上传中…
              </>
            ) : uploadedFile ? (
              <>
                <X className="h-4 w-4" />
                已上传，可重新选择
              </>
            ) : (
              '上传到服务器'
            )}
          </Button>
        </div>
      </section>

      {/* 发布信息表单 */}
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium text-foreground">发布信息</h2>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="publish-title">标题</Label>
          <Input
            id="publish-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="给视频起个吸引人的标题"
            maxLength={55}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="publish-tags">话题标签</Label>
          <Input
            id="publish-tags"
            value={tagsText}
            onChange={(event) => setTagsText(event.target.value)}
            placeholder="多个标签用逗号分隔，如：美食,探店,日常"
          />
          <p className="text-xs text-muted-foreground">
            标签无需带 # 号，会自动补全并加入标题
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="publish-description">描述（可选）</Label>
          <Textarea
            id="publish-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="补充说明，留空则与标题一致"
            rows={3}
          />
        </div>

        <div className="flex justify-end pt-2">
          <Button size="lg" onClick={handlePublish} disabled={publishing || !uploadedFile}>
            {publishing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                发布中…
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                发布到{getPlatformName(platform)}
              </>
            )}
          </Button>
        </div>
      </section>

      {/* 扫码登录弹层 */}
      {loginOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-border/80 bg-card p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-foreground">
                扫码登录{getPlatformName(platform)}
              </h3>
              <Button variant="ghost" size="icon" onClick={closeLogin} aria-label="关闭">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex h-56 items-center justify-center rounded-xl border border-border/80 bg-muted/30">
              {loginStatus === 'success' ? (
                <div className="text-center text-sm text-primary">登录成功，正在刷新账号…</div>
              ) : qrImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qrImage}
                  alt="登录二维码"
                  className="h-full w-full object-contain p-3"
                />
              ) : loginStatus === 'failed' ? (
                <div className="px-4 text-center text-sm text-destructive">
                  {loginMessage || '登录失败'}
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  正在获取二维码…
                </div>
              )}
            </div>

            {loginStatus === 'waiting' && (
              <p className="text-center text-xs text-muted-foreground">
                请使用{getPlatformName(platform)} App 扫描二维码，并确认登录
              </p>
            )}
            {loginStatus === 'failed' && (
              <div className="flex justify-center">
                <Button variant="outline" onClick={() => openLogin('default')}>
                  <RefreshCw className="h-4 w-4" />
                  重新获取
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
