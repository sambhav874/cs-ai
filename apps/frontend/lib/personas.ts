import { apiFetch } from "@/lib/apiClient";

export type Privilege = { privilege: string; label: string };

export type Persona = {
  id: string;
  name: string;
  privileges: string[];
  isSystem: boolean;
  updatedAt: string | null;
};

export type PersonaMember = {
  userId: string;
  username: string | null;
  personaId: string | null;
  personaName: string | null;
  grants: { privilege: string; until: string | null; reason: string | null }[];
};

export type PersonaOverview = {
  personas: Persona[];
  members: PersonaMember[];
  myPrivileges: string[];
};

export type AccessReview = {
  holders: Record<string, { label: string; members: { userId: string; username: string | null }[] }>;
  outstandingGrants: {
    userId: string;
    username: string | null;
    privilege: string;
    until: string | null;
    reason: string | null;
  }[];
};

function base(): string {
  const apiUrl = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL;
  if (!apiUrl) throw new Error("The API URL is not configured.");
  return apiUrl;
}

async function unwrap<T>(response: Response, whatFailed: string): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || `${whatFailed} (${response.status})`);
  }
  return (await response.json()) as T;
}

export async function fetchPrivileges(): Promise<Privilege[]> {
  const data = await unwrap<{ privileges: Privilege[] }>(
    await apiFetch(`${base()}/privileges`),
    "Could not load the privilege list",
  );
  return data.privileges;
}

export async function fetchPersonas(accountId: string): Promise<PersonaOverview> {
  return unwrap<PersonaOverview>(
    await apiFetch(`${base()}/accounts/${accountId}/personas`),
    "Could not load personas",
  );
}

export async function createPersona(
  accountId: string,
  persona: { name: string; privileges: string[] },
): Promise<Persona> {
  return unwrap<Persona>(
    await apiFetch(`${base()}/accounts/${accountId}/personas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(persona),
    }),
    "Could not create the persona",
  );
}

export async function updatePersona(
  accountId: string,
  personaId: string,
  changes: { name?: string; privileges?: string[] },
): Promise<Persona> {
  return unwrap<Persona>(
    await apiFetch(`${base()}/accounts/${accountId}/personas/${personaId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(changes),
    }),
    "Could not save the persona",
  );
}

export async function deletePersona(accountId: string, personaId: string): Promise<void> {
  await unwrap(
    await apiFetch(`${base()}/accounts/${accountId}/personas/${personaId}`, { method: "DELETE" }),
    "Could not delete the persona",
  );
}

export async function assignPersona(
  accountId: string,
  userId: string,
  personaId: string,
): Promise<void> {
  await unwrap(
    await apiFetch(`${base()}/accounts/${accountId}/members/${userId}/persona`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personaId }),
    }),
    "Could not change that member's persona",
  );
}

export async function fetchAccessReview(accountId: string): Promise<AccessReview> {
  return unwrap<AccessReview>(
    await apiFetch(`${base()}/accounts/${accountId}/access-review`),
    "Could not load the access review",
  );
}
