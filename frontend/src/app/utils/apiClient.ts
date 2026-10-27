export interface AppRecord {
  id: string;
  title: string;
  detail: string;
  created_at?: string;
}

const API = `${import.meta.env.BASE_URL}api/records`;

export async function getRecords(): Promise<AppRecord[]> {
  const res = await fetch(API);
  if (!res.ok) throw new Error(`GET records failed: ${res.status}`);
  return res.json();
}

export async function addRecord(
  record: Omit<AppRecord, 'id' | 'created_at'>
): Promise<AppRecord> {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(record),
  });
  if (!res.ok) throw new Error(`POST record failed: ${res.status}`);
  return res.json();
}

export async function clearRecords(): Promise<void> {
  const res = await fetch(API, { method: 'DELETE' });
  if (!res.ok) throw new Error(`DELETE records failed: ${res.status}`);
}
