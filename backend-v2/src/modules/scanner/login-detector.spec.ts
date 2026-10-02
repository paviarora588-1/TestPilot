import { matchesIdentifierHint, matchesSubmitText } from './login-detector';

describe('login-detector — identifier hint matching', () => {
  it('matches common username/email/login/account attribute values', () => {
    expect(matchesIdentifierHint('name="username" id="" placeholder="" aria-label=""')).toBe(true);
    expect(matchesIdentifierHint('name="" id="email" placeholder="" aria-label=""')).toBe(true);
    expect(matchesIdentifierHint('name="" id="" placeholder="Login ID" aria-label=""')).toBe(true);
    expect(matchesIdentifierHint('name="" id="" placeholder="" aria-label="Account number"')).toBe(true);
  });

  it('does not match an unrelated field', () => {
    expect(matchesIdentifierHint('name="search" id="q" placeholder="Search…" aria-label=""')).toBe(false);
  });
});

describe('login-detector — submit button text matching', () => {
  it('matches common sign-in/continue/next labels', () => {
    expect(matchesSubmitText('Sign in')).toBe(true);
    expect(matchesSubmitText('Log In')).toBe(true);
    expect(matchesSubmitText('Continue')).toBe(true);
    expect(matchesSubmitText('Next')).toBe(true);
    expect(matchesSubmitText('Submit')).toBe(true);
  });

  it('does not match an unrelated button', () => {
    expect(matchesSubmitText('Forgot password?')).toBe(false);
    expect(matchesSubmitText('Cancel')).toBe(false);
  });
});
