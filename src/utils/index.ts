/**
 * 通用工具函数
 */

/**
 * 等待 N 毫秒
 */
export const sleep = (ms: number): Promise<void> => {
    return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * 字符串转 ArrayBuffer
 */
export const stringToArrayBuffer = (str: string) => {
    const encoder = new TextEncoder();
    return encoder.encode(str).buffer;
};
