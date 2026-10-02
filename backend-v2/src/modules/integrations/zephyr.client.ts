// Real Zephyr Scale Cloud REST API v2 client (https://api.zephyrscale.smartbear.com/v2).
// Auth is a bearer API access token generated in Zephyr Scale > API Access Tokens.
export interface ZephyrTestCase {
  key: string;
  name: string;
  objective?: string;
  precondition?: string;
}

export async function fetchZephyrTestCases(
  baseUrl: string,
  apiToken: string,
  projectKey: string,
): Promise<ZephyrTestCase[]> {
  const url = `${baseUrl.replace(/\/$/, '')}/testcases?projectKey=${encodeURIComponent(projectKey)}&maxResults=50`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  if (!res.ok) {
    throw new Error(`Zephyr API error: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { values?: Record<string, unknown>[] };
  return (data.values ?? []).map((v) => ({
    key: String(v.key ?? ''),
    name: String(v.name ?? 'Untitled'),
    objective: typeof v.objective === 'string' ? v.objective : undefined,
    precondition: typeof v.precondition === 'string' ? v.precondition : undefined,
  }));
}
