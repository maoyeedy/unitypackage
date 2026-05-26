// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ModeTabs } from './ModeTabs';

describe('ModeTabs', () => {
  it('renders both mode buttons', () => {
    render(<ModeTabs mode="extract" onModeChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /extract/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /pack/i })).toBeInTheDocument();
  });

  it('highlights the active mode', () => {
    const onModeChange = vi.fn();
    const { rerender } = render(<ModeTabs mode="extract" onModeChange={onModeChange} />);
    expect(screen.getByRole('button', { name: /extract/i })).toHaveClass('active');
    expect(screen.getByRole('button', { name: /pack/i })).not.toHaveClass('active');

    rerender(<ModeTabs mode="pack" onModeChange={onModeChange} />);
    expect(screen.getByRole('button', { name: /pack/i })).toHaveClass('active');
    expect(screen.getByRole('button', { name: /extract/i })).not.toHaveClass('active');
  });

  it('calls onModeChange on click', async () => {
    const onModeChange = vi.fn();
    const user = userEvent.setup();
    render(<ModeTabs mode="extract" onModeChange={onModeChange} />);
    await user.click(screen.getByRole('button', { name: /pack/i }));
    expect(onModeChange).toHaveBeenCalledWith('pack');
  });
});
