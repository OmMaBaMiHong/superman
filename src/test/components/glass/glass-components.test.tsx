import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Compass, Rss } from 'lucide-react';
import GlassCard from '@/components/glass/GlassCard';
import StatCard from '@/components/glass/StatCard';
import GlassChip from '@/components/glass/GlassChip';

describe('glass base components', () => {
  it('GlassCard renders the .glass-surface semantic class', () => {
    render(<GlassCard data-testid="glass-card">内容</GlassCard>);

    const card = screen.getByTestId('glass-card');
    expect(card.className).toContain('glass-surface');
    expect(card).toHaveTextContent('内容');
  });

  it('GlassCard supports padded and interactive variants', () => {
    render(
      <GlassCard data-testid="plain" padded={false}>
        a
      </GlassCard>,
    );
    render(
      <GlassCard data-testid="interactive" interactive>
        b
      </GlassCard>,
    );

    expect(screen.getByTestId('plain').className).not.toContain('p-4');
    expect(screen.getByTestId('interactive').className).toContain('glass-surface');
    expect(screen.getByTestId('interactive').className).toContain('hover:border-primary/40');
  });

  it('StatCard renders label, mono value, and primary tinted icon block', () => {
    const { container } = render(
      <StatCard data-testid="stat-card" label="推荐订阅源" value={42} icon={Rss} trend="↑ 12%" />,
    );

    expect(screen.getByText('推荐订阅源')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('↑ 12%')).toBeInTheDocument();

    const card = screen.getByTestId('stat-card');
    expect(card.className).toContain('glass-surface');
    expect(screen.getByText('42').className).toContain('font-mono');
    expect(screen.getByText('42').className).toContain('tabular-nums');

    const iconBlock = container.querySelector('.glass-surface svg')?.parentElement;
    expect(iconBlock?.className).toContain('bg-primary/10');
    expect(iconBlock?.className).toContain('text-primary');
  });

  it('GlassChip renders active and inactive states with semantic classes', () => {
    render(<GlassChip active={false}>全部</GlassChip>);
    render(<GlassChip active>AI</GlassChip>);

    const inactive = screen.getByRole('button', { name: '全部' });
    const active = screen.getByRole('button', { name: 'AI' });

    expect(inactive.className).toContain('glass-surface-light');
    expect(active.className).toContain('bg-primary/15');
    expect(active.className).toContain('text-primary');
    expect(active.className).toContain('border-primary/30');
    expect(inactive).toHaveAttribute('aria-pressed', 'false');
    expect(active).toHaveAttribute('aria-pressed', 'true');
  });

  it('GlassChip forwards an icon child without breaking semantics', () => {
    render(
      <GlassChip active>
        <Compass aria-hidden="true" className="h-3.5 w-3.5" />
        发现
      </GlassChip>,
    );

    const chip = screen.getByRole('button', { name: '发现' });
    expect(chip.querySelector('svg')).not.toBeNull();
  });
});
