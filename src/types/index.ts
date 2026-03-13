export type LogType = 'LOG' | 'WARN' | 'ERROR';

export interface LogItem {
    timeStamp?: number;
    text?: string;
    type?: LogType;
    logObj?: any;
    error?: any;
}
