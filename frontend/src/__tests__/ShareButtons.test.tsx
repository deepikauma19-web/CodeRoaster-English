import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ShareButtons } from '../components/share/ShareButtons';
import { toggleRoastShare } from '../services/shareApi';
import type { Roast } from '../types/roast';
import { axiosError, makeRoast } from './utils/fixtures';
import { renderWithChakra } from './utils/renderWithProviders';

vi.mock('../services/shareApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/shareApi')>();
  return { ...actual, toggleRoastShare: vi.fn() };
});

const mockToggle = vi.mocked(toggleRoastShare);
const SHARE_URL = 'http://localhost:8000/api/v1/public/share/abc123';
// Absolute links use VITE_API_URL when set, otherwise the page origin.
const ORIGIN = import.meta.env.VITE_API_URL || window.location.origin;

function Harness({ initial, onRoastChange }: { initial: Roast; onRoastChange: (r: Roast) => void }) {
  const [roast, setRoast] = useState<Roast>(initial);
  return (
    <ShareButtons
      roast={roast}
      onRoastChange={(next) => {
        setRoast(next);
        onRoastChange(next);
      }}
    />
  );
}

const toggle = (): HTMLElement => screen.getByRole('checkbox', { name: 'Make public' });

describe('ShareButtons', () => {
  beforeEach(() => {
    mockToggle.mockReset();
  });

  it('making public calls toggleRoastShare + onRoastChange and shows share links', async () => {
    const user = userEvent.setup();
    const onRoastChange = vi.fn();
    mockToggle.mockResolvedValue({ is_public: true, share_slug: 'abc123', share_url: SHARE_URL });
    renderWithChakra(<Harness initial={makeRoast({ id: 9, is_public: false })} onRoastChange={onRoastChange} />);

    expect(toggle()).not.toBeChecked();
    expect(screen.queryByLabelText('Share link')).not.toBeInTheDocument();
    expect(screen.getByText('Make it public to share')).toBeInTheDocument();

    await user.click(toggle());
    await waitFor(() => expect(mockToggle).toHaveBeenCalledWith(9, true));
    expect(onRoastChange).toHaveBeenCalledWith(expect.objectContaining({ id: 9, is_public: true, share_slug: 'abc123' }));

    expect(await screen.findByLabelText('Share link')).toHaveValue(SHARE_URL);
    expect(toggle()).toBeChecked();
    expect(await screen.findByText(/Your roast is public now/)).toBeInTheDocument();

    const encoded = encodeURIComponent(SHARE_URL);
    const whatsapp = screen.getByRole('link', { name: 'Share on WhatsApp' });
    const linkedin = screen.getByRole('link', { name: 'Share on LinkedIn' });
    const x = screen.getByRole('link', { name: 'Share on X' });
    expect(whatsapp.getAttribute('href')).toContain('https://wa.me/?text=');
    expect(whatsapp.getAttribute('href')).toContain(encoded);
    expect(linkedin).toHaveAttribute('href', `https://www.linkedin.com/sharing/share-offsite/?url=${encoded}`);
    expect(x.getAttribute('href')).toMatch(/^https:\/\/twitter\.com\/intent\/tweet\?text=.+&url=/);
    expect(x.getAttribute('href')).toContain(`&url=${encoded}`);
    for (const link of [whatsapp, linkedin, x]) {
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      expect(link).toHaveAttribute('target', '_blank');
    }
  });

  it('builds the share URL from the slug for an already-public roast and copies it', async () => {
    const user = userEvent.setup();
    renderWithChakra(
      <ShareButtons roast={makeRoast({ is_public: true, share_slug: 'my-slug' })} onRoastChange={vi.fn()} />,
    );
    const input = screen.getByLabelText('Share link');
    expect((input as HTMLInputElement).value).toMatch(/\/api\/v1\/public\/share\/my-slug$/);
    await user.click(screen.getByRole('button', { name: 'Copy share link' }));
    expect(await screen.findByText('Copied')).toBeInTheDocument();
    await expect(navigator.clipboard.readText()).resolves.toMatch(/my-slug$/);
  });

  it('making private calls toggleRoastShare(id, false) and hides links', async () => {
    const user = userEvent.setup();
    const onRoastChange = vi.fn();
    mockToggle.mockResolvedValue({ is_public: false, share_slug: 'my-slug', share_url: null });
    renderWithChakra(
      <Harness initial={makeRoast({ id: 3, is_public: true, share_slug: 'my-slug' })} onRoastChange={onRoastChange} />,
    );
    await user.click(toggle());
    await waitFor(() => expect(mockToggle).toHaveBeenCalledWith(3, false));
    await waitFor(() => expect(screen.queryByLabelText('Share link')).not.toBeInTheDocument());
    expect(onRoastChange).toHaveBeenCalledWith(expect.objectContaining({ is_public: false }));
  });

  it('shows an error toast and keeps state on failure', async () => {
    const user = userEvent.setup();
    const onRoastChange = vi.fn();
    mockToggle.mockRejectedValue(axiosError(409, { detail: 'Roast not completed yet' }));
    renderWithChakra(<Harness initial={makeRoast({ is_public: false })} onRoastChange={onRoastChange} />);
    await user.click(toggle());
    expect(await screen.findByText('Could not change the share setting')).toBeInTheDocument();
    expect(screen.getByText('Roast not completed yet')).toBeInTheDocument();
    expect(onRoastChange).not.toHaveBeenCalled();
    expect(toggle()).not.toBeChecked();
  });

  it('is disabled until the roast is completed', () => {
    renderWithChakra(<ShareButtons roast={makeRoast({ status: 'analyzing' })} onRoastChange={vi.fn()} />);
    expect(toggle()).toBeDisabled();
    expect(screen.getByText(/You can share once the roast is complete/)).toBeInTheDocument();
  });

  it('is disabled with an explanation when secrets were detected', () => {
    renderWithChakra(
      <Harness initial={makeRoast({ is_public: false, secrets_detected: 2 })} onRoastChange={vi.fn()} />,
    );
    expect(toggle()).toBeDisabled();
    expect(screen.getByTestId('share-blocked')).toHaveTextContent(/secrets were found/);
  });

  it('is disabled with an explanation when sharing was blocked after reports', () => {
    renderWithChakra(
      <Harness initial={makeRoast({ is_public: false, share_blocked: true })} onRoastChange={vi.fn()} />,
    );
    expect(toggle()).toBeDisabled();
    expect(screen.getByTestId('share-blocked')).toHaveTextContent(/was reported/);
  });

  it('shows a README badge preview and markdown once the roast is public', () => {
    renderWithChakra(
      <Harness
        initial={makeRoast({ id: 9, is_public: true, share_slug: 'abc123' })}
        onRoastChange={vi.fn()}
      />,
    );
    const snippet = screen.getByTestId('badge-snippet');
    expect(snippet).toHaveTextContent('README badge');
    const markdown = screen.getByLabelText('Badge markdown') as HTMLInputElement;
    expect(markdown.value).toBe(
      `[![Code Roaster score](${ORIGIN}/api/v1/public/roasts/abc123/badge.svg)](${ORIGIN}/api/v1/public/share/abc123)`,
    );
    expect(screen.getByAltText('Code Roaster score badge')).toHaveAttribute(
      'src',
      `${ORIGIN}/api/v1/public/roasts/abc123/badge.svg`,
    );
  });

  it('does not show the badge while the roast is private', () => {
    renderWithChakra(<Harness initial={makeRoast({ is_public: false })} onRoastChange={vi.fn()} />);
    expect(screen.queryByTestId('badge-snippet')).not.toBeInTheDocument();
  });
});
