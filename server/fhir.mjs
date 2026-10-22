/**
 * FHIR R4 view of a Record Vault record.
 *
 * Mapping (deliberately small and explicit):
 * - The record's patient becomes a Patient resource, identified by wallet
 *   address. No names or demographics exist in the vault to map.
 * - The registry grant to the demo clinician becomes a Consent resource:
 *   READ maps to the ConsentAction value "access", WRITE to "use"; the grant
 *   expiry becomes the provision period end. An absent or expired grant maps
 *   to an inactive Consent. This is an approximation of consent semantics,
 *   documented as such — the chain grant remains the source of truth.
 * - Each version's content: if it parses as a JSON object with a
 *   `resourceType`, it is embedded as that FHIR resource (the vault's seeded
 *   records already store FHIR-shaped payloads); otherwise it is wrapped as
 *   a DocumentReference with base64 text content.
 */

const ACTION_BY_PERMISSION = [[1, 'access'], [2, 'use']];

export function consentResource({ recordId, patient, delegate, permissions, expiresAt, nowSeconds }) {
  const active = permissions > 0 && expiresAt > nowSeconds;
  const actions = ACTION_BY_PERMISSION.filter(([bit]) => permissions & bit).map(([, action]) => action);
  return {
    resourceType: 'Consent',
    id: `consent-${recordId.slice(2, 10)}-${String(delegate).slice(2, 10)}`,
    status: active ? 'active' : 'inactive',
    scope: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/consentscope', code: 'patient-privacy' }] },
    category: [{ coding: [{ system: 'http://loinc.org', code: '57016-8' }] }],
    patient: { reference: `Patient/${patient}` },
    dateTime: new Date(nowSeconds * 1000).toISOString(),
    performer: [{ reference: `Patient/${patient}` }],
    organization: [{ display: 'CORG Record Vault (synthetic local demo)' }],
    provision: {
      type: active ? 'permit' : 'deny',
      period: { end: new Date(expiresAt * 1000).toISOString() },
      actor: [{ reference: { reference: `Practitioner/${delegate}` } }],
      action: actions.map(action => ({ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/consentaction', code: action }] })),
      purpose: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason', code: 'TREAT', display: 'Treatment' }],
    },
    meta: { tag: [{ system: 'https://corgdata.io/fhir-mapping', code: 'vault-grant-approximation', display: 'Derived from the on-chain grant; the chain remains authoritative' }] },
  };
}

function versionResource({ recordId, version, payload, author, createdAt }) {
  try {
    const parsed = JSON.parse(payload.content);
    if (parsed && typeof parsed === 'object' && typeof parsed.resourceType === 'string') {
      return { ...parsed, id: parsed.id ?? `${recordId.slice(2, 10)}-v${version}`, meta: { ...(parsed.meta ?? {}), versionId: String(version), lastUpdated: createdAt } };
    }
  } catch { /* not JSON: falls through to DocumentReference */ }
  return {
    resourceType: 'DocumentReference',
    id: `${recordId.slice(2, 10)}-v${version}`,
    status: 'current',
    type: { text: payload.category },
    subject: { display: `Record ${recordId}` },
    date: createdAt,
    author: [{ display: author }],
    content: [{ attachment: { contentType: 'text/plain', data: Buffer.from(payload.content, 'utf8').toString('base64'), title: payload.title } }],
    meta: { versionId: String(version) },
  };
}

export function toFhirBundle({ record, versions, grant, nowSeconds }) {
  const resources = [
    { resourceType: 'Patient', id: record.patient, identifier: [{ system: 'https://corgdata.io/wallet-address', value: record.patient }], meta: { tag: [{ code: 'synthetic', display: 'Synthetic demo patient' }] } },
    consentResource({ recordId: record.id, patient: record.patient, delegate: grant.delegate, permissions: grant.permissions, expiresAt: grant.expiresAt, nowSeconds }),
    ...versions.map(v => versionResource(v)),
  ];
  return { resourceType: 'Bundle', type: 'collection', timestamp: new Date(nowSeconds * 1000).toISOString(), total: resources.length, entry: resources.map(resource => ({ resource })) };
}
