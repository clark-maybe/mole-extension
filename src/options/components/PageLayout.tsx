import type { ReactNode } from 'react';
import { Card, Typography } from 'antd';

const { Paragraph, Text, Title } = Typography;

export interface OptionsMetricItem {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  accent?: 'blue' | 'green' | 'orange' | 'red' | 'neutral';
}

interface OptionsPageLayoutProps {
  eyebrow?: string;
  title: string;
  description: ReactNode;
  extra?: ReactNode;
  metrics?: OptionsMetricItem[];
  children: ReactNode;
}

interface OptionsSectionCardProps {
  title: ReactNode;
  description?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Options 页面统一头部布局
 * 统一管理标题、操作区和概览指标卡
 */
export function OptionsPageLayout({
  eyebrow,
  title,
  description,
  extra,
  metrics,
  children,
}: OptionsPageLayoutProps) {
  return (
    <div className="options-view">
      <div className="options-view-hero">
        <div className="options-view-hero-main">
          {eyebrow ? <Text className="options-view-eyebrow">{eyebrow}</Text> : null}
          <Title level={2} className="options-view-title">
            {title}
          </Title>
          <Paragraph className="options-view-description">{description}</Paragraph>
        </div>
        {extra ? <div className="options-view-actions">{extra}</div> : null}
      </div>

      {metrics?.length ? (
        <div className="options-metrics-grid">
          {metrics.map((metric) => (
            <div
              key={metric.label}
              className={`options-metric-card options-metric-${metric.accent || 'neutral'}`}
            >
              <Text className="options-metric-label">{metric.label}</Text>
              <div className="options-metric-value">{metric.value}</div>
              {metric.hint ? <Text className="options-metric-hint">{metric.hint}</Text> : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className="options-view-content">{children}</div>
    </div>
  );
}

/**
 * Options 页面统一内容卡片
 * 对齐后台设置页的分组信息结构
 */
export function OptionsSectionCard({
  title,
  description,
  extra,
  children,
  className,
}: OptionsSectionCardProps) {
  return (
    <Card className={`options-surface-card${className ? ` ${className}` : ''}`}>
      {(title || description || extra) ? (
        <div className="options-surface-card-header">
          <div className="options-surface-card-copy">
            <Text className="options-surface-card-title">{title}</Text>
            {description ? (
              <Paragraph className="options-surface-card-description">{description}</Paragraph>
            ) : null}
          </div>
          {extra ? <div className="options-surface-card-extra">{extra}</div> : null}
        </div>
      ) : null}

      <div className="options-surface-card-body">{children}</div>
    </Card>
  );
}
