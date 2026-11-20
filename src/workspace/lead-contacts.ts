/** 将不同批次的联系方式整理为可联系条目；励销云来源默认可信。 */
import type { Lead, LeadContact } from './types';

function contactValue(value: unknown): { kind: LeadContact['kind']; value: string; key: string } | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return;
  const content = String(value).normalize('NFKC').trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(content)) return { kind: 'email', value: content, key: content.toLowerCase() };
  if (!/^[+\d\s().-]+$/.test(content)) return;
  const digits = content.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 16) return;
  const key = digits.replace(/^86(?=1[3-9]\d{9}$)/, '');
  return { kind: 'phone', value: content, key };
}

export function getLeadContacts(lead: Lead): LeadContact[] {
  const contacts = new Map<string, LeadContact>();
  const legal = contactValue(lead.fields.legalPersonPhone);
  const add = (value: unknown, name?: unknown, role?: unknown, sources?: unknown) => {
    const parsed = contactValue(value);
    if (!parsed) return;
    const key = `${parsed.kind}:${parsed.key}`;
    const item = contacts.get(key) || { kind: parsed.kind, value: parsed.value, names: [], roles: [], sources: [],
      trusted: lead.provider === 'lixiaoyun', legalRepresentative: parsed.kind === 'phone' && parsed.key === legal?.key };
    const push = (target: string[], raw: unknown) => { if (typeof raw === 'string' && raw.trim() && !target.includes(raw.trim())) target.push(raw.trim()); };
    push(item.names, name); push(item.roles, role);
    for (const source of Array.isArray(sources) ? sources : [sources]) push(item.sources, source);
    contacts.set(key, item);
  };
  if (Array.isArray(lead.fields.contactDetails)) for (const value of lead.fields.contactDetails) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    add(value.content, value.contactName, [value.department, value.position].filter(item => typeof item === 'string' && item).join(' · '), value.sources);
  }
  // 明细优先，兜底兼容旧档案中的电话、邮箱等单字段，不依赖新增可信标记。
  for (const field of ['legalPersonPhone', 'contact', 'phone', 'mobile', 'email']) {
    const raw = lead.fields[field];
    if (typeof raw !== 'string') continue;
    for (const value of raw.split(/[,，;；\n]+/)) {
      const parsed = contactValue(value);
      if (parsed && contacts.has(`${parsed.kind}:${parsed.key}`)) continue;
      add(value, field === 'legalPersonPhone' ? lead.fields.legalPerson : lead.fields.contactName,
        field === 'legalPersonPhone' ? '法定代表人' : lead.fields.contactPosition);
    }
  }
  return [...contacts.values()];
}
