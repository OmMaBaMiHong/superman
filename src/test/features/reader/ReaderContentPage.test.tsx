import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/overview/components/OverviewPage', () => ({
  default: function MockOverviewPage() {
    return <div data-testid="mock-overview-page">总览</div>;
  },
}));

vi.mock('@/features/workbench/components/WorkbenchPage', () => ({
  default: function MockWorkbenchPage() {
    return <div data-testid="mock-workbench-page">工作台</div>;
  },
}));

vi.mock('@/features/discover/components/DiscoverPage', () => ({
  default: function MockDiscoverPage() {
    return <div data-testid="mock-discover-page">发现</div>;
  },
}));

import ReaderContentPage from '@/features/reader/components/ReaderContentPage';
import { useAppStore } from '@/store/appStore';
import {
  OVERVIEW_VIEW_ID,
  PUBLISH_CENTER_VIEW_ID,
  DISCOVER_VIEW_ID,
  ARTICLE_VIEW_ID,
} from '@/lib/reader/view';

describe('ReaderContentPage', () => {
  afterEach(() => {
    useAppStore.setState({ feeds: [] });
  });

  it('renders OverviewPage for the overview view', () => {
    render(<ReaderContentPage view={OVERVIEW_VIEW_ID} />);

    expect(screen.getByTestId('mock-overview-page')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-workbench-page')).not.toBeInTheDocument();
  });

  it('renders WorkbenchPage for the publish-center (workbench) view', () => {
    render(<ReaderContentPage view={PUBLISH_CENTER_VIEW_ID} />);

    expect(screen.getByTestId('mock-workbench-page')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-overview-page')).not.toBeInTheDocument();
  });

  it('renders DiscoverPage for the discover view', () => {
    render(<ReaderContentPage view={DISCOVER_VIEW_ID} />);

    expect(screen.getByTestId('mock-discover-page')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-overview-page')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mock-workbench-page')).not.toBeInTheDocument();
  });

  it('returns null for non-content-page views', () => {
    const { container } = render(<ReaderContentPage view="all" />);
    expect(container).toBeEmptyDOMElement();

    const { container: feedContainer } = render(<ReaderContentPage view={ARTICLE_VIEW_ID} />);
    expect(feedContainer).toBeEmptyDOMElement();

    const { container: unknownContainer } = render(<ReaderContentPage view="feed-1" />);
    expect(unknownContainer).toBeEmptyDOMElement();
  });
});
