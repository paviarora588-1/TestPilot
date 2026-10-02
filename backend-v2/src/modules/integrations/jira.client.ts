// Real Jira Cloud REST API v3 client. Auth is Basic (email + API token, per
// https://id.atlassian.com/manage-profile/security/api-tokens).
export interface JiraIssue {
  key: string;
  summary: string;
  description: string;
}

interface AdfNode {
  text?: string;
  content?: AdfNode[];
}

// Jira v3's `description` field is Atlassian Document Format, not plain text —
// walk the node tree and concatenate every leaf's text.
function extractAdfText(node: AdfNode | string | null | undefined): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node.content)) return node.content.map(extractAdfText).join(' ');
  return node.text ?? '';
}

export async function fetchJiraIssues(
  baseUrl: string,
  email: string,
  apiToken: string,
  projectKey: string,
): Promise<JiraIssue[]> {
  const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');
  const jql = encodeURIComponent(`project=${projectKey} ORDER BY created DESC`);
  const url = `${baseUrl.replace(/\/$/, '')}/rest/api/3/search?jql=${jql}&maxResults=50`;
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Jira API error: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as {
    issues?: { key: string; fields?: { summary?: string; description?: AdfNode } }[];
  };
  return (data.issues ?? []).map((issue) => ({
    key: issue.key,
    summary: issue.fields?.summary ?? '',
    description: extractAdfText(issue.fields?.description),
  }));
}

export interface JiraLinkedIssue {
  key: string;
  relationship: string;
  summary?: string;
}

export interface JiraIssueDetail extends JiraIssue {
  acceptanceCriteria: string | null;
  labels: string[];
  components: string[];
  priority: string | null;
  status: string | null;
  // Only next-gen ("team-managed") Jira Cloud projects expose the epic link
  // as fields.parent — classic ("company-managed") projects put it behind a
  // per-site custom field id (e.g. customfield_10014) that isn't discoverable
  // from the issue payload alone, so this is best-effort, not guaranteed.
  epicKey: string | null;
  linkedIssues: JiraLinkedIssue[];
}

// Single-story fetch for the deep-analysis flow — separate from the bulk
// project search above, which only pulls summary/description for many issues
// at once. "Acceptance criteria" isn't a standard Jira REST field (it's
// usually a heading written inline in the description, or a team-specific
// custom field with no stable id across Jira sites) — this pulls it out of
// the description text if present under a conventional heading; otherwise
// the AI step downstream reads the full description anyway.
export async function fetchJiraIssue(
  baseUrl: string,
  email: string,
  apiToken: string,
  issueKey: string,
): Promise<JiraIssueDetail> {
  const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');
  const url = `${baseUrl.replace(/\/$/, '')}/rest/api/3/issue/${issueKey}`;
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Jira API error: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as {
    key: string;
    fields?: {
      summary?: string;
      description?: AdfNode;
      labels?: string[];
      components?: { name: string }[];
      priority?: { name: string };
      status?: { name: string };
      parent?: { key: string };
      issuelinks?: {
        type: { inward: string; outward: string };
        inwardIssue?: { key: string; fields?: { summary?: string } };
        outwardIssue?: { key: string; fields?: { summary?: string } };
      }[];
    };
  };

  const description = extractAdfText(data.fields?.description);
  const match = description.match(/acceptance criteria[:\s]*(.+)/i);

  const linkedIssues: JiraLinkedIssue[] = (data.fields?.issuelinks ?? []).map((link) => {
    const linked = link.inwardIssue ?? link.outwardIssue;
    const relationship = link.inwardIssue ? link.type.inward : link.type.outward;
    return { key: linked?.key ?? 'unknown', relationship, summary: linked?.fields?.summary };
  });

  return {
    key: data.key,
    summary: data.fields?.summary ?? '',
    description,
    acceptanceCriteria: match ? match[1].trim() : null,
    labels: data.fields?.labels ?? [],
    components: (data.fields?.components ?? []).map((c) => c.name),
    priority: data.fields?.priority?.name ?? null,
    status: data.fields?.status?.name ?? null,
    epicKey: data.fields?.parent?.key ?? null,
    linkedIssues,
  };
}

export interface JiraComment {
  author: string;
  body: string;
  created: string;
}

// Comments frequently carry clarifications, scope changes, and edge cases
// that never make it into the story description itself — a senior QA
// engineer would read these before writing test cases, so this pipeline
// should too. `maxResults` keeps this bounded on a chatty long-running story.
export async function fetchJiraIssueComments(
  baseUrl: string,
  email: string,
  apiToken: string,
  issueKey: string,
  maxResults = 20,
): Promise<JiraComment[]> {
  const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');
  const url = `${baseUrl.replace(/\/$/, '')}/rest/api/3/issue/${issueKey}/comment?maxResults=${maxResults}&orderBy=-created`;
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Jira API error: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as {
    comments?: { author?: { displayName?: string }; body?: AdfNode; created?: string }[];
  };
  return (data.comments ?? []).map((c) => ({
    author: c.author?.displayName ?? 'Unknown',
    body: extractAdfText(c.body),
    created: c.created ?? '',
  }));
}

export interface JiraAttachmentMeta {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  contentUrl: string;
}

// Only metadata — separate from downloadJiraAttachment below so the caller
// can filter (by type/size/count) before spending a second request and a
// parse pass on anything it doesn't actually want.
export async function fetchJiraIssueAttachments(
  baseUrl: string,
  email: string,
  apiToken: string,
  issueKey: string,
): Promise<JiraAttachmentMeta[]> {
  const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');
  const url = `${baseUrl.replace(/\/$/, '')}/rest/api/3/issue/${issueKey}?fields=attachment`;
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Jira API error: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as {
    fields?: { attachment?: { id: string; filename: string; mimeType: string; size: number; content: string }[] };
  };
  return (data.fields?.attachment ?? []).map((a) => ({
    id: a.id,
    filename: a.filename,
    mimeType: a.mimeType,
    size: a.size,
    contentUrl: a.content,
  }));
}

// Attachment bytes live behind their own authenticated URL (the `content`
// field from the metadata above), not inline in the issue payload — has to
// be a separate request per attachment.
export async function downloadJiraAttachment(email: string, apiToken: string, contentUrl: string): Promise<Buffer> {
  const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');
  const res = await fetch(contentUrl, { headers: { Authorization: `Basic ${auth}` } });
  if (!res.ok) {
    throw new Error(`Jira attachment download error: ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

// Jira v3 requires the `description` field in Atlassian Document Format on
// create, not plain text — this is the minimal inverse of extractAdfText
// above: one paragraph node per input line.
function textToAdf(text: string): AdfNode & { type: string; version: number } {
  return {
    type: 'doc',
    version: 1,
    content: text
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => ({ type: 'paragraph', content: [{ type: 'text', text: line }] }) as unknown as AdfNode),
  };
}

export interface CreatedJiraIssue {
  key: string;
  url: string;
}

// Creates a real Jira issue (used by the Bug Report Generation flow) —
// separate from fetchJiraIssues/fetchJiraIssue above, which only ever read.
// `issueType` defaults to "Bug", the standard Jira Cloud issue type name;
// a site with a renamed/custom scheme would need this passed explicitly.
export async function createJiraIssue(
  baseUrl: string,
  email: string,
  apiToken: string,
  projectKey: string,
  fields: { summary: string; description: string; issueType?: string },
): Promise<CreatedJiraIssue> {
  const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');
  const url = `${baseUrl.replace(/\/$/, '')}/rest/api/3/issue`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fields: {
        project: { key: projectKey },
        summary: fields.summary,
        description: textToAdf(fields.description),
        issuetype: { name: fields.issueType ?? 'Bug' },
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`Jira API error: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { key: string };
  return { key: data.key, url: `${baseUrl.replace(/\/$/, '')}/browse/${data.key}` };
}
