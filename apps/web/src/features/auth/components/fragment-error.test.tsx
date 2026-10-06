import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FragmentError } from './fragment-error';

const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));

afterEach(() => {
  replace.mockClear();
  window.history.replaceState(null, '', '/');
});

describe('FragmentError', () => {
  it('maps a refusal in the URL fragment to the refusal card', () => {
    window.history.replaceState(
      null,
      '',
      "/login?error=auth&next=%2Fx#error=access_denied&error_description=You're+not+on+the+DxT+Monitor+access+list+yet.",
    );
    render(<FragmentError />);
    expect(replace).toHaveBeenCalledWith('/login?error=access&next=%2Fx');
  });

  it('does nothing without a fragment error', () => {
    window.history.replaceState(null, '', '/login');
    render(<FragmentError />);
    expect(replace).not.toHaveBeenCalled();
  });
});
