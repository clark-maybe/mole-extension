import type { CompanyInfo, CompanySearchProviderId } from './company-types';

export interface ParsedCompanySearchPayload {
    total: number;
    items: CompanyInfo[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function asString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function asNumber(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function parseTags(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((tag) => asString(asRecord(tag)?.tagName))
        .filter((tag) => tag.length > 0);
}

function parseDate(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const text = asString(value);
    if (!text) return undefined;
    const timestamp = Date.parse(text);
    return Number.isFinite(timestamp) ? timestamp : undefined;
}

function parseLixiaoyunPayload(payload: unknown): ParsedCompanySearchPayload {
    const body = asRecord(payload);
    if (!body) throw new Error('企业搜索响应格式无效');
    if (body.success === false) throw new Error(asString(body.message) || '企业搜索接口返回失败');

    const data = asRecord(body.data);
    if (!data) throw new Error('企业搜索响应缺少 data');
    if (!Array.isArray(data.items)) throw new Error('企业搜索响应缺少 items 数组');
    const rawItems = data.items;
    const items: CompanyInfo[] = rawItems.flatMap((rawItem) => {
        const item = asRecord(rawItem);
        if (!item) return [];
        const name = asString(item.companyName) || asString(item.name) || asString(item.value);
        if (!name) return [];
        return [{
            id: asString(item.id),
            name,
            englishName: asString(item.entNameEng),
            legalPerson: asString(item.legalperson),
            contact: '',
            contactName: asString(item.contactName),
            contactPosition: asString(item.contactPosition),
            contactAddress: asString(item.contactaddress),
            address: asString(item.address) || asString(item.regAddress),
            status: asString(item.entstatus),
            industry: asString(item.industry),
            secondIndustry: asString(item.secondIndustry),
            thirdIndustry: asString(item.thirdIndustry),
            fourthIndustry: asString(item.fourthIndustry),
            registeredCapital: asString(item.regCapDisplay) || asString(item.registercapital),
            establishmentDate: asNumber(item.esdate) || undefined,
            officialWebsite: asString(item.officialWebsite),
            socialCreditCode: asString(item.socialCreditCode),
            tags: parseTags(item.companyTags),
            contactDetails: [],
            contactLoaded: false,
        }];
    });

    return { total: asNumber(data.total) || items.length, items };
}

function parseFengniaoyunPayload(payload: unknown): ParsedCompanySearchPayload {
    const body = asRecord(payload);
    if (!body) throw new Error('风鸟云企业搜索响应格式无效');
    if (body.success !== true || asNumber(body.code) !== 20000) {
        throw new Error(asString(body.msg) || '风鸟云企业搜索接口返回失败，请确认已登录');
    }
    const data = asRecord(body.data);
    if (!data) throw new Error('风鸟云企业搜索响应缺少 data');
    if (!Array.isArray(data.list)) throw new Error('风鸟云响应缺少 list 数组');
    const rawItems = data.list;
    const items: CompanyInfo[] = rawItems.flatMap((rawItem) => {
        const item = asRecord(rawItem);
        if (!item) return [];
        const name = asString(item.entName);
        if (!name) return [];
        const phones = Array.isArray(item.tels) ? item.tels.map(asString).filter(Boolean) : [];
        const emails = Array.isArray(item.emails) ? item.emails.map(asString).filter(Boolean) : [];
        const tags = [
            ...(Array.isArray(item.tags) ? item.tags.map(asString) : []),
            ...(Array.isArray(item.riskTagNames) ? item.riskTagNames.map(asString) : []),
        ].filter(Boolean);
        return [{
            id: asString(item.entid) || asString(item.uniscid),
            name,
            englishName: '',
            legalPerson: asString(item.faren),
            contact: phones[0] || '',
            contactName: '',
            contactPosition: '',
            contactAddress: asString(item.dom2) || asString(item.dom),
            address: asString(item.dom2) || asString(item.dom),
            status: asString(item.entStatus),
            industry: '',
            secondIndustry: '',
            thirdIndustry: '',
            fourthIndustry: '',
            registeredCapital: asString(item.regConcat) || asString(item.regCap),
            establishmentDate: parseDate(item.esDate),
            officialWebsite: asString(item.website),
            socialCreditCode: asString(item.uniscid),
            email: emails[0] || undefined,
            tags: Array.from(new Set(tags)),
            contactDetails: [],
            contactLoaded: true,
        }];
    });
    return { total: asNumber(data.total) || items.length, items };
}

/** 按企业查询平台响应格式提取用于展示的统一企业字段。 */
export function parseCompanySearchPayload(payload: unknown, provider: CompanySearchProviderId = 'lixiaoyun'): ParsedCompanySearchPayload {
    return provider === 'fengniaoyun' ? parseFengniaoyunPayload(payload) : parseLixiaoyunPayload(payload);
}
