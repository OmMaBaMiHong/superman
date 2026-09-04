import type { FeedContentView } from '@/types';

export interface RecommendedFeed {
  title: string;
  url: string;
  category: string;
  view: FeedContentView;
  description: string;
  accent: string;
  sourceType: 'rsshub' | 'rss';
}

export const RECOMMENDED_FEEDS: RecommendedFeed[] = [
  {
    title: 'Andrej Karpathy YouTube',
    url: 'rsshub://youtube/user/@AndrejKarpathy',
    category: 'Recommended',
    view: 'video',
    description: 'AI、深度学习和工程思考的视频更新，适合验证 RSSHub 视频订阅链路。',
    accent: 'RSSHub · Video',
    sourceType: 'rsshub',
  },
  {
    title: 'OpenAI Blog',
    url: 'https://openai.com/blog/rss.xml',
    category: 'Recommended',
    view: 'article',
    description: '官方产品、研究和安全更新，适合作为 AI 知识库的基础订阅源。',
    accent: 'AI',
    sourceType: 'rss',
  },
  {
    title: 'Hacker News Front Page',
    url: 'https://hnrss.org/frontpage',
    category: 'Recommended',
    view: 'social',
    description: '技术社区热点和讨论入口，适合追踪工程趋势。',
    accent: 'HN',
    sourceType: 'rss',
  },
];
