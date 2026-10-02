import { fetchJiraIssue, fetchJiraIssueComments, fetchJiraIssueAttachments } from './jira.client';

function mockFetchOnce(body: unknown, ok = true) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

describe('jira.client', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  describe('fetchJiraIssue', () => {
    it('extracts labels, components, priority, status, epic, and linked issues from the issue response', async () => {
      mockFetchOnce({
        key: 'RP-217',
        fields: {
          summary: 'Add password strength meter',
          description: { type: 'doc', content: [{ type: 'paragraph', content: [{ text: 'Show a strength meter.' }] }] },
          labels: ['ui', 'security'],
          components: [{ name: 'Registration' }, { name: 'Password Reset' }],
          priority: { name: 'High' },
          status: { name: 'In Progress' },
          parent: { key: 'RP-100' },
          issuelinks: [
            {
              type: { inward: 'is blocked by', outward: 'blocks' },
              inwardIssue: { key: 'RP-50', fields: { summary: 'Password policy config' } },
            },
          ],
        },
      });

      const issue = await fetchJiraIssue('https://x.atlassian.net', 'a@b.com', 'token', 'RP-217');

      expect(issue.key).toBe('RP-217');
      expect(issue.labels).toEqual(['ui', 'security']);
      expect(issue.components).toEqual(['Registration', 'Password Reset']);
      expect(issue.priority).toBe('High');
      expect(issue.status).toBe('In Progress');
      expect(issue.epicKey).toBe('RP-100');
      expect(issue.linkedIssues).toEqual([{ key: 'RP-50', relationship: 'is blocked by', summary: 'Password policy config' }]);
      expect(issue.description).toContain('Show a strength meter.');
    });

    it('defaults to empty/null when optional fields are absent', async () => {
      mockFetchOnce({ key: 'RP-1', fields: { summary: 'X' } });
      const issue = await fetchJiraIssue('https://x.atlassian.net', 'a@b.com', 'token', 'RP-1');
      expect(issue.labels).toEqual([]);
      expect(issue.components).toEqual([]);
      expect(issue.priority).toBeNull();
      expect(issue.status).toBeNull();
      expect(issue.epicKey).toBeNull();
      expect(issue.linkedIssues).toEqual([]);
    });

    it('throws with the response body on a non-ok response', async () => {
      mockFetchOnce({ errorMessages: ['not found'] }, false);
      await expect(fetchJiraIssue('https://x.atlassian.net', 'a@b.com', 'token', 'RP-999')).rejects.toThrow('Jira API error: 500');
    });
  });

  describe('fetchJiraIssueComments', () => {
    it('extracts author, ADF body text, and created date', async () => {
      mockFetchOnce({
        comments: [
          {
            author: { displayName: 'Jane QA' },
            body: { type: 'doc', content: [{ type: 'paragraph', content: [{ text: 'Edge case: empty password field.' }] }] },
            created: '2026-07-01T00:00:00.000Z',
          },
        ],
      });
      const comments = await fetchJiraIssueComments('https://x.atlassian.net', 'a@b.com', 'token', 'RP-217');
      expect(comments).toEqual([
        { author: 'Jane QA', body: 'Edge case: empty password field.', created: '2026-07-01T00:00:00.000Z' },
      ]);
    });

    it('returns an empty array when there are no comments', async () => {
      mockFetchOnce({ comments: [] });
      const comments = await fetchJiraIssueComments('https://x.atlassian.net', 'a@b.com', 'token', 'RP-217');
      expect(comments).toEqual([]);
    });
  });

  describe('fetchJiraIssueAttachments', () => {
    it('extracts attachment metadata', async () => {
      mockFetchOnce({
        fields: {
          attachment: [
            { id: '1', filename: 'spec.pdf', mimeType: 'application/pdf', size: 1024, content: 'https://x.atlassian.net/attachment/1' },
          ],
        },
      });
      const attachments = await fetchJiraIssueAttachments('https://x.atlassian.net', 'a@b.com', 'token', 'RP-217');
      expect(attachments).toEqual([
        { id: '1', filename: 'spec.pdf', mimeType: 'application/pdf', size: 1024, contentUrl: 'https://x.atlassian.net/attachment/1' },
      ]);
    });
  });
});
