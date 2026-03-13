/** 日志模块 */
import {VERSION, LOG_LEVEL} from "../config";
import Storage from "../lib/storage";
import dayjs from "dayjs";
import type { LogItem, LogType } from "../types";

// 定义日志模块接口
interface ILogger {
    log: (txt: string, obj?: any) => void;
    warn: (txt: string, obj?: any) => void;
    error: (txt: string, error?: any) => void;
}

/**
 * 上报日志到 background（汇总日志）
 * 使用 chrome.runtime.sendMessage 而不是 Channel，因为 Channel 可能还没初始化
 */
const reportToBackground = (logItem: LogItem) => {
    try {
        // 只在非 background 环境中上报
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage({
                type: '__log_report',
                data: logItem
            }).catch(() => {
                // 忽略错误（可能 background 还没准备好）
            });
        }
    } catch (e) {
        // 忽略错误
    }
};

/**
 * 核心日志处理函数
 * @param type - 日志类型
 * @param txt - 日志文本
 * @param data - 附加数据 (可以是普通对象或Error对象)
 * @private
 */
const _createLogEntry = (type: LogType, txt: string, data?: any) => {
    const logItem: LogItem = {
        timeStamp: new Date().getTime(),
        text: txt,
        type: type,
    };

    if (type === 'ERROR') {
        logItem.error = data;
    } else {
        logItem.logObj = data;
    }

    // 使用新的 Storage 方法 异步，可能会出现顺序不正常情况，以时间为准
    Storage.addLog(logItem);

    // 错误日志额外存储到独立的错误日志存储中，便于问题排查
    if (type === 'ERROR') {
        Storage.addErrorLog(logItem);
    }

    // 上报到 background（汇总日志）
    reportToBackground(logItem);

    const timeStamp = logItem.timeStamp;
    const innerText = logItem.text;

    const tempText = `[${dayjs(timeStamp).format('YYYY-MM-DD HH:mm:ss.SSS')}][${type}] ---> ${innerText}`;
    const textTitle = `%c Mole %c V${VERSION} `;
    const titleStyle = 'padding: 2px 1px; border-radius: 3px 0 0 3px; color: #fff; background: #606060; font-weight: bold;';
    const versionStyle = 'padding: 2px 1px; border-radius: 0 3px 3px 0; color: #fff; background: #42c02e; font-weight: bold;';

    switch (type) {
        case 'LOG':
            //仅在DEBUG模式下输出日志
            if (LOG_LEVEL !== 'DEBUG') return;
            console.log(textTitle, titleStyle, versionStyle, tempText, data);
            break;
        case 'WARN':
            //仅在DEBUG或WARN模式下输出警告日志
            if (LOG_LEVEL === 'ERROR') return;
            console.warn(textTitle, titleStyle, versionStyle, tempText, data);
            break;
        case 'ERROR':
            //始终输出错误日志
            console.error(textTitle, titleStyle, versionStyle, tempText, data);
            break;
    }
};

const _log = (txt: string, obj?: any) => {
    _createLogEntry('LOG', txt, obj);
};

const _warn = (txt: string, obj?: any) => {
    _createLogEntry('WARN', txt, obj);
};

const _error = (txt: string, error?: any) => {
    _createLogEntry('ERROR', txt, error);
};


const logger: ILogger = {
    log: _log,
    warn: _warn,
    error: _error
};

export default logger;