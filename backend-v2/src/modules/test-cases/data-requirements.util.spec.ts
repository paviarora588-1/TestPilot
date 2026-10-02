import { buildDataRequirementGroups, dataItemKeyFor, suggestFieldValue } from './data-requirements.util';

describe('suggestFieldValue', () => {
  it('does not flag a plain "System" field as a password, even though its screen is named "New Password"', () => {
    // Regression for a bug found testing the RP (Reset Password) app: pattern
    // matching used to run against the screen-qualified display label
    // ("System dropdown (New Password)"), so ANY field on a screen whose name
    // contains "password" got misclassified as a password field. This test
    // matches against objectName only, as the fix requires.
    const result = suggestFieldValue('System', 'obj-1');
    expect(result.sensitive).toBe(false);
    expect(result.value).toBeNull();
  });

  it('still recognizes a field genuinely named "Password"', () => {
    const result = suggestFieldValue('Password', 'obj-2');
    expect(result.sensitive).toBe(true);
    expect(result.value).toMatch(/^Pw\d{6}!$/);
  });

  it('recognizes common field patterns deterministically (same seed -> same value)', () => {
    const first = suggestFieldValue('Email', 'obj-3');
    const second = suggestFieldValue('Email', 'obj-3');
    expect(first.value).toBe('{{randomEmail}}');
    expect(second.value).toBe(first.value);
  });

  it('gives different seeds different suggestions for name fields, not a fixed constant', () => {
    const values = new Set(
      Array.from({ length: 20 }, (_, i) => suggestFieldValue('First Name', `obj-${i}`).value),
    );
    expect(values.size).toBeGreaterThan(1);
  });

  it('returns null for app-specific fields with no safe generic guess', () => {
    const result = suggestFieldValue('Role Name', 'obj-4');
    expect(result.value).toBeNull();
    expect(result.sensitive).toBe(false);
  });
});

describe('buildDataRequirementGroups', () => {
  const objects = [
    { id: 'sys-new', objectName: 'System', displayLabel: 'System dropdown (New Password)', screenName: 'New Password', objectType: 'text-input' },
    { id: 'uid-new', objectName: 'User ID', displayLabel: 'User ID', screenName: 'New Password', objectType: 'text-input' },
    { id: 'submit-new', objectName: 'Submit', displayLabel: 'Submit', screenName: 'New Password', objectType: 'button' },
  ];

  it('groups fields by screen and excludes non-input object types', () => {
    const groups = buildDataRequirementGroups('Click on the New Password tab', objects);
    expect(groups).toHaveLength(1);
    expect(groups[0].screenName).toBe('New Password');
    const names = groups[0].fields.map((f) => f.objectName);
    expect(names).toEqual(expect.arrayContaining(['System', 'User ID']));
    expect(names).not.toContain('Submit');
  });

  it('does not mark the System field sensitive despite the screen name containing "password"', () => {
    const groups = buildDataRequirementGroups('Click on the New Password tab', objects);
    const systemField = groups[0].fields.find((f) => f.objectName === 'System');
    expect(systemField?.sensitive).toBe(false);
    expect(systemField?.suggestedValue).toBeNull();
  });
});

describe('dataItemKeyFor', () => {
  it('matches the exact key format generateFromTestCase uses to look up/reuse a TestDataItem', () => {
    expect(dataItemKeyFor('System', 'New Password')).toBe('System - New Password');
  });

  it('falls back to just the object name when there is no screen', () => {
    expect(dataItemKeyFor('System', null)).toBe('System');
  });
});
