/** 从旧版企业查询迁移的统一字段。 */
export interface CompanyContactInfo {
    content: string;
    type: string;
    contactName: string;
    department: string;
    position: string;
    area: string;
    carrier: string;
    status: string;
    valid?: boolean;
    sources: string[];
}

export interface CompanyInfo {
    id: string;
    name: string;
    englishName: string;
    legalPerson: string;
    contact: string;
    contactName: string;
    contactPosition: string;
    contactAddress: string;
    address: string;
    status: string;
    industry: string;
    secondIndustry: string;
    thirdIndustry: string;
    fourthIndustry: string;
    registeredCapital: string;
    establishmentDate?: number;
    officialWebsite: string;
    socialCreditCode: string;
    email?: string;
    tags: string[];
    contactDetails?: CompanyContactInfo[];
    contactLoaded?: boolean;
}


export type CompanySearchProviderId = 'lixiaoyun' | 'fengniaoyun';
