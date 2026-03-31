/**
 * Mole Content Script
 * 注入到每个页面，创建悬浮球 UI
 */
import _console from './lib/console';
import Channel from './lib/channel';
// React 版悬浮球（重构中）
import { initFloatBallReact } from './content/float-ball-react';
// 旧版保留，待迁移完成后删除
// import { initFloatBall } from './content/float-ball';
import { initPageParser } from './content/page-parser';
import { initActionExecutor } from './content/action-executor';
import { initPageGrounding } from './content/page-grounding';
import { initPageSkeleton } from './content/page-skeleton';

// content script 加载
console.log('[Mole] content script 已加载, hostname:', window.location.hostname);

// 初始化 Channel 通信
Channel.listen(0);

// 获取自身 tab 信息
Channel.send('__get_tab_info', {}, (tabInfo: any) => {
    if (tabInfo) {
        _console.log(`[Mole] 已连接 tab: ${tabInfo.id}, url: ${tabInfo.url}`);
    }
});

// 初始化网页内容解析器（供 background 远程调用获取页面信息）
initPageParser();

// 初始化页面动作执行器（供 background 远程调用执行页面交互操作）
initActionExecutor();

// 初始化页面 grounding 能力（语义快照 + element_id 动作）
initPageGrounding();

// 初始化页面骨架树（层级化 DOM 感知）
initPageSkeleton();

// 初始化悬浮球（React 版）
initFloatBallReact();
