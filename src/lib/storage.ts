import type { LogItem } from "../types";
import { MAX_LOG_NUM, VERSION } from "../config";
import dayjs from "dayjs";

/**
 * Chrome Extension 持久化存储模块
 * 基于 chrome.storage.local API
 */

// 获取数据
const get = <T>(key: string): Promise<T | undefined> => {
    return new Promise((resolve) => {
        chrome.storage.local.get(key, (result) => {
            resolve(result[key] as T | undefined);
        });
    });
};

// 存入数据
const save = (key: string, data: any): Promise<void> => {
    return new Promise((resolve) => {
        chrome.storage.local.set({ [key]: data }, resolve);
    });
};

// 清除所有存储
const clear_all = (): Promise<void> => {
    return new Promise((resolve) => {
        chrome.storage.local.clear(resolve);
    });
};

// 清除日志
const clearLogs = (): Promise<void> => {
    return new Promise((resolve) => {
        chrome.storage.local.remove('log_data', resolve);
    });
};

/**
 * 添加一条日志（循环缓冲区）
 */
const addLog = async (item: LogItem): Promise<void> => {
    const logs = (await get<LogItem[]>('log_data')) || [];
    if (logs.length >= MAX_LOG_NUM) {
        logs.shift();
    }
    logs.push(item);
    return new Promise((resolve) => {
        chrome.storage.local.set({ log_data: logs }, resolve);
    });
};

/**
 * 获取所有日志
 */
const getLogs = async (): Promise<LogItem[]> => {
    return (await get<LogItem[]>('log_data')) || [];
};

/**
 * 导出日志
 */
const exportLogs = async () => {
    const log_data = await getLogs();

    let text = `EXPORT_TIME: ${dayjs().format('YYYY-MM-DD HH:mm:ss')} | VERSION: ${VERSION} | UA: ${navigator.userAgent} \n\n`;

    for (let i = 0; i < log_data.length; i++) {
        const timeStamp = log_data[i].timeStamp;
        const type = log_data[i].type;
        const innerText = log_data[i].text;
        log_data[i].timeStamp = void 0;
        log_data[i].type = void 0;
        log_data[i].text = void 0;

        text += `[${dayjs(timeStamp).format('YYYY-MM-DD HH:mm:ss.SSS')}][${type}] ---> ${innerText} --- ${JSON.stringify(log_data[i])} \n`;
    }

    const blob = new Blob([text], { type: 'text/plain' });
    const fileName = `Mole-LOG-${dayjs().format('YYYY-MM-DD_HH:mm:ss')}`;

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${fileName}.log`;
    link.click();
    URL.revokeObjectURL(url);
    await clearLogs();
};

const Storage = {
    save,
    get,
    clear_all,
    addLog,
    getLogs,
    exportLogs,
};

export default Storage;
