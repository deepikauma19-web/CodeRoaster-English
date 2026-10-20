import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { IntensityPicker } from '../components/roast/IntensityPicker';
import { RoastCard } from '../components/roast/RoastCard';
import { RoastLoader } from '../components/roast/RoastLoader';
import { ScoreBreakdownBars } from '../components/roast/ScoreBreakdownBars';
import { ScoreGauge } from '../components/roast/ScoreGauge';
import { TipsList } from '../components/roast/TipsList';
import { AuthorChip } from '../components/share/AuthorChip';
import type { RoastIntensity, Tip } from '../types/roast';
import { renderWithChakra } from './utils/renderWithProviders';

function ControlledPicker({ onChange }: { onChange: (v: RoastIntensity) => void }) {
  const [value, setValue] = useState<RoastIntensity>('medium');
  return (
    <IntensityPicker
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange(v);
      }}
    />
  );
}

const radio = (value: RoastIntensity): HTMLInputElement => {
  const el = screen.getAllByRole<HTMLInputElement>('radio').find((r) => r.value === value);
  if (!el) throw new Error(`radio ${value} not found`);
  return el;
};

describe('IntensityPicker', () => {
  it('renders 3 options with medium selected by default', () => {
    renderWithChakra(<IntensityPicker onChange={vi.fn()} />);
    const group = screen.getByRole('radiogroup', { name: 'Roast intensity' });
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(radio('medium')).toBeChecked();
    expect(radio('mild')).not.toBeChecked();
    expect(radio('extra_spicy')).not.toBeChecked();
  });

  it('click changes the value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithChakra(<ControlledPicker onChange={onChange} />);
    await user.click(screen.getByText('Extra Spicy'));
    expect(onChange).toHaveBeenLastCalledWith('extra_spicy');
    expect(radio('extra_spicy')).toBeChecked();
  });

  it('keyboard arrows move the selection', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithChakra(<ControlledPicker onChange={onChange} />);
    radio('medium').focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('extra_spicy');
    await user.keyboard('{ArrowLeft}');
    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith('mild');
    expect(radio('mild')).toBeChecked();
  });

  // BUG: isDisabled is passed to useRadioGroup but not to each useRadio, so the native inputs stay
  // enabled and clicking a card while the form is submitting still fires onChange.
  it.fails('is not changeable when disabled (BUG: isDisabled not forwarded to radios)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithChakra(<IntensityPicker onChange={onChange} isDisabled />);
    await user.click(screen.getByText('Mild'));
    expect(onChange).not.toHaveBeenCalled();
    for (const r of screen.getAllByRole('radio')) expect(r).toBeDisabled();
  });

  // BUG: getRadioProps() puts aria-hidden="true" on the visual card, which contains the only label
  // text, so each native radio has an empty accessible name for screen readers.
  it.fails('each radio has an accessible name (BUG: label text is aria-hidden)', () => {
    renderWithChakra(<IntensityPicker onChange={vi.fn()} />);
    expect(screen.getByRole('radio', { name: /Mild/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Medium/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Extra Spicy/ })).toBeInTheDocument();
  });
});

describe('ScoreGauge', () => {
  it.each([
    [10, 'Burnt 🔥'],
    [45, 'Half-boiled'],
    [72, 'Decent'],
    [95, 'Excellent! 🏆'],
  ])('score %i has aria-label with score and band %s', (score, label) => {
    renderWithChakra(<ScoreGauge score={score} animated={false} />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', `Score ${score} out of 100: ${label}`);
    expect(screen.getByTestId('score-band')).toHaveTextContent(label);
  });

  it('clamps out-of-range scores', () => {
    renderWithChakra(<ScoreGauge score={140} animated={false} />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'Score 100 out of 100: Excellent! 🏆');
  });

  it('labels with the target score even while animating', () => {
    renderWithChakra(<ScoreGauge score={55} />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'Score 55 out of 100: Half-boiled');
  });
});

describe('ScoreBreakdownBars', () => {
  it('renders five category bars out of 20 and clamps', () => {
    renderWithChakra(
      <ScoreBreakdownBars
        breakdown={{ code_quality: 15, structure: 25, documentation: -3, ai_best_practices: 8, security: 20 }}
      />,
    );
    const bars = screen.getAllByRole('progressbar');
    expect(bars).toHaveLength(5);
    expect(screen.getByLabelText('Code Quality: 15 out of 20')).toBeInTheDocument();
    expect(screen.getByLabelText('Structure: 20 out of 20')).toBeInTheDocument();
    expect(screen.getByLabelText('Documentation: 0 out of 20')).toBeInTheDocument();
    expect(screen.getByLabelText('AI Best Practices: 8 out of 20')).toBeInTheDocument();
    expect(screen.getByLabelText('Security: 20 out of 20')).toBeInTheDocument();
    expect(screen.getByText('15/20')).toBeInTheDocument();
  });
});

describe('TipsList', () => {
  const tips: Tip[] = [
    { title: 'Move secrets', description: 'Use .env', priority: 'high', file_path: 'config.py' },
    { title: 'Add tests', description: 'pytest pls', priority: 'medium', file_path: null },
    { title: 'Fix README', description: 'Typos', priority: 'low', file_path: null },
  ];

  it('shows the empty state', () => {
    renderWithChakra(<TipsList tips={[]} interactive />);
    expect(screen.getByTestId('tips-empty')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('renders priority badges, titles and file paths without checkboxes when not interactive', () => {
    renderWithChakra(<TipsList tips={tips} />);
    expect(screen.getByText('high')).toBeInTheDocument();
    expect(screen.getByText('medium')).toBeInTheDocument();
    expect(screen.getByText('low')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Move secrets' })).toBeInTheDocument();
    expect(screen.getByText('config.py')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByText(/fixed$/)).not.toBeInTheDocument();
  });

  it('interactive mode tracks done count locally', async () => {
    const user = userEvent.setup();
    renderWithChakra(<TipsList tips={tips} interactive />);
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.getByText('0/3 fixed')).toBeInTheDocument();
    const first = screen.getByRole('checkbox', { name: 'Mark "Move secrets" as done' });
    await user.click(first);
    expect(first).toBeChecked();
    expect(screen.getByText('1/3 fixed')).toBeInTheDocument();
    await user.click(first);
    expect(screen.getByText('0/3 fixed')).toBeInTheDocument();
  });
});

describe('RoastCard', () => {
  it('renders markdown formatting', () => {
    renderWithChakra(<RoastCard markdown={'# Title\n\nHello **bold** `code`\n\n- one\n- two\n\n1. first'} />);
    expect(screen.getByText('bold').tagName).toBe('STRONG');
    expect(screen.getByText('code')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument();
  });

  it('does NOT render raw HTML from the markdown source', () => {
    const malicious = [
      '<script>window.__pwned = true</script>',
      '',
      '<img src="x" onerror="window.__pwned = true">',
      '',
      '<iframe src="https://evil.example"></iframe>',
      '',
      'Inline <b onclick="alert(1)">bold</b> text',
      '',
      '![tracker](https://evil.example/pixel.png)',
      '',
      '[click me](javascript:alert(1))',
    ].join('\n');
    const { container } = renderWithChakra(<RoastCard markdown={malicious} />);
    const card = screen.getByTestId('roast-card');
    expect(card.querySelector('script')).toBeNull();
    expect(card.querySelector('img')).toBeNull();
    expect(card.querySelector('iframe')).toBeNull();
    expect(card.querySelector('b')).toBeNull();
    expect(container.querySelector('[onerror]')).toBeNull();
    expect(container.querySelector('[onclick]')).toBeNull();
    const link = card.querySelector('a');
    expect(link).not.toBeNull();
    expect(link).toHaveTextContent('click me');
    expect(link?.getAttribute('href') ?? '').not.toMatch(/^javascript:/i);
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
  });

  it('uses a custom title', () => {
    renderWithChakra(<RoastCard markdown="hi" title="Custom" />);
    expect(screen.getByRole('heading', { name: 'Custom' })).toBeInTheDocument();
  });
});

describe('RoastLoader', () => {
  it('marks the current step', () => {
    renderWithChakra(<RoastLoader status="fetching" />);
    expect(screen.getByTestId('roast-loader')).toHaveAttribute('role', 'status');
    expect(screen.getByText('Fetching repo').closest('[aria-current="step"]')).not.toBeNull();
    expect(screen.getByText('Cloning the repo… no judgement yet.')).toBeInTheDocument();
  });
});

describe('AuthorChip', () => {
  it('falls back to Anonymous dev', () => {
    renderWithChakra(<AuthorChip firstName="  " avatarUrl={null} />);
    expect(screen.getByTestId('author-chip')).toHaveTextContent('Anonymous dev');
  });
});
