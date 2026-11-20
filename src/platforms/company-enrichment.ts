/** 只做可验证的企业名匹配和法人手机归属，不用首个电话代替法人手机。 */
export const normalizeCompanyName = (name: string): string => name.normalize('NFKC').replace(/\s+/g, '').toLowerCase();

export function findLegalRepresentativeMobile(details: unknown, legalPerson: string): { phone: string; index: number } | undefined {
  if (!Array.isArray(details)) return;
  for (const [index, value] of details.entries()) {
    if (!value || typeof value !== 'object') continue;
    const item = value as Record<string, unknown>;
    const name = String(item.contactName || '').trim();
    const role = /法定代表人|法人/.test(String(item.position || '')) || /^(法定代表人|法人)$/.test(name);
    const sameName = Boolean(legalPerson.trim()) && normalizeCompanyName(name) === normalizeCompanyName(legalPerson);
    // 联系人姓名明确与法人不同时，不把可能过期的职位标记当作归属证明。
    if (!sameName && !(role && (!legalPerson.trim() || !name || /^(法定代表人|法人)$/.test(name)))) continue;
    const digits = String(item.content || '').replace(/[\s()-]/g, '');
    const match = digits.match(/^(?:\+?86)?(1[3-9]\d{9})$/);
    if (match) return { phone: match[1], index };
  }
}
