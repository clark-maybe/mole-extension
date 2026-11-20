/** 销售档案只展示可读业务字段，原始值仍保留在追溯区。 */
import type { Json, Provider } from '../../workspace/types';

export const providerLabels: Record<Provider, string> = { lixiaoyun: '励销云', douyin: '抖音', riskbird: '风鸟云（历史）', mantis_crm: '螳螂 CRM', web: '网页' };
export const fieldLabels: Record<string, string> = {
  legalPerson: '法定代表人', legalPersonPhone: '法人手机号', contact: '联系电话', contactName: '联系人', contactPosition: '联系人职位',
  contactDetails: '联系方式明细', contactAddress: '联系地址', socialCreditCode: '统一社会信用代码', address: '注册地址', status: '经营状态',
  industry: '所属行业', secondIndustry: '细分行业', thirdIndustry: '三级行业', fourthIndustry: '四级行业', registeredCapital: '注册资本',
  establishmentDate: '成立日期', officialWebsite: '官方网站', englishName: '英文名称', tags: '企业标签', signature: '账号简介',
  nickname: '账号名称', name: '企业名称', email: '邮箱', phone: '电话', mobile: '手机', contactLoaded: '联系方式已获取', id: '平台企业 ID',
};

export function displayField(field: string, value: Json | undefined): string {
  if (value === undefined || value === null || value === '') return '';
  if (field === 'establishmentDate') {
    const timestamp = typeof value === 'number' ? value : /^\d{10,13}$/.test(String(value)) ? Number(value) : undefined;
    const date = timestamp !== undefined ? new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp) : new Date(String(value));
    if (!Number.isNaN(date.getTime())) return date.toLocaleDateString('zh-CN');
  }
  if (Array.isArray(value)) return value.filter(item => typeof item === 'string' || typeof item === 'number').join('、');
  if (typeof value === 'object') return '';
  return typeof value === 'boolean' ? value ? '是' : '否' : String(value);
}

export function sourceLink(value: string): string | undefined {
  return /^https?:\/\//i.test(value) ? value : undefined;
}
