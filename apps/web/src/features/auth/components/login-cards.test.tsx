import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RefusalCard } from './refusal-card';
import { SignInCard } from './sign-in-card';

describe('SignInCard', () => {
  it('links to Google sign-in and keeps `next`', () => {
    render(<SignInCard next="/incidents/x" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in with Google' })).toHaveAttribute(
      'href',
      '/auth/sign-in?next=%2Fincidents%2Fx',
    );
    expect(screen.getByText(/straight back to the page you opened/)).toBeInTheDocument();
    expect(screen.queryByText(/30 days/)).toBeNull(); // D-011
  });

  it('shows why the last attempt failed', () => {
    render(<SignInCard next="/" failed />);
    expect(screen.getByText('Sign-in didn’t finish')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in with Google' })).toHaveAttribute(
      'href',
      '/auth/sign-in',
    );
  });
});

describe('RefusalCard', () => {
  it('names the refused non-company account', () => {
    render(<RefusalCard reason="domain" email="someone@gmail.com" next="/" />);
    expect(screen.getByRole('heading', { name: 'This account can’t sign in' })).toBeInTheDocument();
    expect(screen.getByText('someone@gmail.com')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Use a different account' })).toHaveAttribute(
      'href',
      '/auth/sign-in',
    );
  });

  it('tells a company account off the list to ask an Admin — no invite email, no names', () => {
    const { container } = render(<RefusalCard reason="access" email={null} next="/incidents/x" />);
    expect(screen.getByRole('heading', { name: 'No access yet' })).toBeInTheDocument();
    expect(screen.getByText('Ask an Admin to add you')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Tao|email; the invite|7 days/);
    expect(screen.getByRole('link', { name: 'Use a different account' })).toHaveAttribute(
      'href',
      '/auth/sign-in?next=%2Fincidents%2Fx',
    );
  });

  it('explains a deactivated account', () => {
    render(<RefusalCard reason="deactivated" email="former@example.test" next="/" />);
    expect(screen.getByRole('heading', { name: 'Account deactivated' })).toBeInTheDocument();
    expect(screen.getByText('former@example.test')).toBeInTheDocument();
    expect(screen.getByText('Think this is a mistake?')).toBeInTheDocument();
  });
});
